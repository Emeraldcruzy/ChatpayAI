/**
 * MantleGuard Telegram Bot Server
 * 
 * Handles: webhook routing, NLP intent parsing, wallet mapping,
 * conversation memory, and confirmation flows.
 * 
 * Stack: Node.js + grammy + viem
 */

import { Bot, Context, session, InlineKeyboard } from 'grammy';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseUnits, formatUnits } from 'viem';
import { mantle } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from './config.js';
import { AgentEngine } from './agent-engine.js';
import { SchedulerService } from './scheduler.js';

// ─── TYPES ────────────────────────────────────────────────────

interface SessionData {
  walletAddress?: string;
  pendingAction?: PendingAction;
  conversationHistory: ConversationEntry[];
  zkTier: number;
}

interface PendingAction {
  type: 'transfer' | 'schedule' | 'upgrade' | 'withdraw';
  params: Record<string, any>;
  expiresAt: number;
}

interface ConversationEntry {
  role: 'user' | 'bot';
  message: string;
  timestamp: number;
}

// ─── INTENT PARSING ───────────────────────────────────────────

const INTENT_PATTERNS = {
  transfer: [
    /^(?:send|transfer|pay)\s+\$?([\d.]+)\s+(?:to\s+)?(.+)/i,
    /^(?:send|transfer)\s+(.+)\s+\$?([\d.]+)/i,
  ],
  balance: [
    /^(?:balance|check balance|how much|my funds|show balance)/i,
    /^\/balance$/i,
  ],
  schedule: [
    /^(?:schedule|pay|send)\s+\$?([\d.]+)\s+(?:to\s+)?(.+?)\s+(daily|weekly|biweekly|monthly|every\s+\d+\s+days?)/i,
    /^(?:pay|send)\s+(.+?)\s+\$?([\d.]+)\s+(monthly|weekly|daily)/i,
  ],
  tier: [
    /^(?:tier|my tier|check tier|identity|zk tier)/i,
    /^\/tier$/i,
  ],
  upgrade: [
    /^(?:upgrade|upgrade tier|verify identity)/i,
    /^\/upgrade$/i,
  ],
  history: [
    /^(?:history|transactions|tx history|recent)/i,
    /^\/history$/i,
  ],
  gas: [
    /^(?:gas|mnt|gas reserve|check gas)/i,
    /^\/gas$/i,
  ],
  cancel: [
    /^(?:cancel|stop)\s+(?:schedule\s+)?#?(\d+)/i,
    /^\/cancel\s+(\d+)/i,
  ],
  help: [
    /^(?:help|commands|start|what can you do)/i,
    /^\/(?:help|start)$/i,
  ],
};

function parseIntent(message: string): { intent: string; params: Record<string, any> } {
  const text = message.trim();

  // Transfer
  for (const pattern of INTENT_PATTERNS.transfer) {
    const match = text.match(pattern);
    if (match) {
      return {
        intent: 'transfer',
        params: { amount: parseFloat(match[1]), recipient: match[2]?.trim() },
      };
    }
  }

  // Schedule
  for (const pattern of INTENT_PATTERNS.schedule) {
    const match = text.match(pattern);
    if (match) {
      return {
        intent: 'schedule',
        params: {
          amount: parseFloat(match[1] || match[2]),
          recipient: (match[2] || match[1])?.trim(),
          frequency: (match[3] || 'monthly').toLowerCase(),
        },
      };
    }
  }

  // Cancel
  for (const pattern of INTENT_PATTERNS.cancel) {
    const match = text.match(pattern);
    if (match) return { intent: 'cancel', params: { scheduleId: parseInt(match[1]) } };
  }

  // Simple intents
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (['transfer', 'schedule', 'cancel'].includes(intent)) continue;
    for (const pattern of patterns) {
      if (pattern.test(text)) return { intent, params: {} };
    }
  }

  return { intent: 'unknown', params: { raw: text } };
}

// ─── WALLET MAPPING ───────────────────────────────────────────

const walletMap: Map<number, string> = new Map(); // telegramId -> walletAddress

function getUserWallet(telegramId: number): string | undefined {
  return walletMap.get(telegramId);
}

function linkWallet(telegramId: number, address: string): void {
  walletMap.set(telegramId, address);
}

// ─── BOT SETUP ────────────────────────────────────────────────

const bot = new Bot<Context>(config.TELEGRAM_BOT_TOKEN);

// Session middleware for conversation memory
bot.use(session({
  initial: (): SessionData => ({
    conversationHistory: [],
    zkTier: 0,
  }),
}));

// ─── VIEM CLIENT ──────────────────────────────────────────────

const publicClient = createPublicClient({
  chain: mantle,
  transport: http(config.MANTLE_RPC_URL),
});

// ─── COMMAND HANDLERS ─────────────────────────────────────────

bot.command('start', async (ctx) => {
  const welcome = `
🛡️ *MantleGuard* — Your AI Financial Agent

I help you manage payments, schedules, and identity verification on Mantle.

*Quick Commands:*
• \`Send $50 to alice.eth\` — one-time transfer
• \`Pay rent $800 monthly\` — recurring payment
• \`/balance\` — check mUSD & MNT balances
• \`/tier\` — view your ZK identity tier
• \`/upgrade\` — upgrade tier with ZK proof
• \`/gas\` — check MNT gas reserve
• \`/history\` — transaction history

*Getting Started:*
1. Link your wallet: \`/connect <address>\`
2. Deposit mUSD for payments
3. Deposit MNT for gas
4. Start sending! Just type naturally.

All payments in *mUSD* · Gas paid in *MNT* · Privacy via *ZK proofs*
  `;
  await ctx.reply(welcome, { parse_mode: 'Markdown' });
});

bot.command('connect', async (ctx) => {
  const address = ctx.match?.trim();
  if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
    return ctx.reply('❌ Please provide a valid Ethereum address:\n`/connect 0x1234...abcd`', { parse_mode: 'Markdown' });
  }
  linkWallet(ctx.from!.id, address);
  await ctx.reply(`✅ Wallet linked: \`${address.slice(0, 6)}...${address.slice(-4)}\`\n\nYour identity tier: *Tier 0* ($50/day limit)\nUpgrade with \`/upgrade\` for higher limits.`, { parse_mode: 'Markdown' });
});

// ─── NATURAL LANGUAGE HANDLER ─────────────────────────────────

bot.on('message:text', async (ctx) => {
  const userId = ctx.from!.id;
  const wallet = getUserWallet(userId);
  const text = ctx.message!.text;

  // Parse intent
  const { intent, params } = parseIntent(text);

  // Check wallet linkage for financial operations
  const financialIntents = ['transfer', 'schedule', 'balance', 'gas', 'history', 'cancel'];
  if (financialIntents.includes(intent) && !wallet) {
    return ctx.reply(
      '🔗 Please link your wallet first:\n`/connect 0xYourAddress`',
      { parse_mode: 'Markdown' }
    );
  }

  switch (intent) {
    case 'transfer':
      await handleTransfer(ctx, wallet!, params);
      break;
    case 'schedule':
      await handleSchedule(ctx, wallet!, params);
      break;
    case 'balance':
      await handleBalance(ctx, wallet!);
      break;
    case 'tier':
      await handleTier(ctx, wallet || '');
      break;
    case 'upgrade':
      await handleUpgrade(ctx, wallet || '');
      break;
    case 'gas':
      await handleGas(ctx, wallet!);
      break;
    case 'history':
      await handleHistory(ctx, wallet!);
      break;
    case 'cancel':
      await handleCancel(ctx, wallet!, params);
      break;
    case 'help':
      await ctx.reply('Type /start to see all available commands!');
      break;
    default:
      await handleUnknown(ctx, text);
      break;
  }
});

// ─── HANDLER IMPLEMENTATIONS ──────────────────────────────────

async function handleTransfer(ctx: Context, wallet: string, params: Record<string, any>) {
  const { amount, recipient } = params;

  // Step 1: Check ZK tier
  await ctx.reply(`🔍 Checking identity tier for \`${wallet.slice(0, 6)}...${wallet.slice(-4)}\`...`, { parse_mode: 'Markdown' });

  // Simulated tier check (in production, reads from IdentityRegistry contract)
  const tier = 1; // would call identityRegistry.getUserTier(wallet)
  const tierLimits = { 0: 50, 1: 500, 2: Infinity };
  const limit = tierLimits[tier as keyof typeof tierLimits];

  if (amount > limit) {
    return ctx.reply(
      `⚠️ *Limit Exceeded*\n\nYour Tier ${tier} limit: $${limit}/day\nRequested: $${amount}\n\nUpgrade with \`/upgrade\` to increase your limit.`,
      { parse_mode: 'Markdown' }
    );
  }

  // Step 2: Estimate gas
  const estimatedGas = 0.002; // would call gasReserve.getEffectiveFee()

  // Step 3: Confirmation flow
  const keyboard = new InlineKeyboard()
    .text('✅ Confirm', `confirm_transfer_${amount}_${recipient}`)
    .text('❌ Cancel', 'cancel_action');

  await ctx.reply(
    `📤 *Transfer Summary*\n\n` +
    `Amount: *$${amount} mUSD*\n` +
    `To: \`${recipient}\`\n` +
    `Gas: ~${estimatedGas} MNT\n` +
    `Tier: ${tier} (Limit: $${limit}/day)\n\n` +
    `Confirm this transfer?`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function handleSchedule(ctx: Context, wallet: string, params: Record<string, any>) {
  const { amount, recipient, frequency } = params;

  // Calculate MNT reserve needed (12 months of gas for monthly)
  const cycleMap: Record<string, number> = { daily: 365, weekly: 52, biweekly: 26, monthly: 12 };
  const cycles = cycleMap[frequency] || 12;
  const gasNeeded = (0.002 * cycles).toFixed(3);

  const keyboard = new InlineKeyboard()
    .text('✅ Create Schedule', `confirm_schedule_${amount}_${recipient}_${frequency}`)
    .text('❌ Cancel', 'cancel_action');

  await ctx.reply(
    `📅 *Schedule Payment*\n\n` +
    `Amount: *$${amount} mUSD*\n` +
    `To: \`${recipient}\`\n` +
    `Frequency: *${frequency}*\n` +
    `Est. annual gas: ~${gasNeeded} MNT\n\n` +
    `This will auto-execute ${frequency}. Confirm?`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function handleBalance(ctx: Context, wallet: string) {
  // In production, these would be real contract reads
  const mUSDBalance = '1,250.00';
  const mntBalance = '5.432';
  const dailySpent = '150.00';
  const dailyLimit = '500.00';

  await ctx.reply(
    `💰 *Your Balances*\n\n` +
    `mUSD: *$${mUSDBalance}*\n` +
    `MNT:  *${mntBalance} MNT*\n\n` +
    `📊 Daily spending: $${dailySpent} / $${dailyLimit}\n` +
    `🛡️ Tier: 1 (Basic ZK)`,
    { parse_mode: 'Markdown' }
  );
}

async function handleTier(ctx: Context, wallet: string) {
  const tiers = [
    { level: 0, name: 'No Proof', limit: '$50/day', status: wallet ? '✅ Current' : '' },
    { level: 1, name: 'Basic ZK Proof', limit: '$500/day', status: '' },
    { level: 2, name: 'Advanced ZK Proof', limit: 'Unlimited', status: '' },
  ];

  let msg = `🛡️ *ZK Identity Tiers*\n\n`;
  for (const t of tiers) {
    const marker = t.status ? ` ← ${t.status}` : '';
    msg += `*Tier ${t.level}*: ${t.name}\n  Limit: ${t.limit}${marker}\n\n`;
  }
  msg += `Use \`/upgrade\` to submit a ZK proof.`;

  await ctx.reply(msg, { parse_mode: 'Markdown' });
}

async function handleUpgrade(ctx: Context, wallet: string) {
  await ctx.reply(
    `🔐 *ZK Identity Upgrade*\n\n` +
    `To upgrade your tier, you'll submit a zero-knowledge proof that verifies your identity *without revealing personal information*.\n\n` +
    `*Tier 1 (Basic)*: Proof of personhood\n` +
    `*Tier 2 (Advanced)*: Government ID attestation\n\n` +
    `Your proof is verified on-chain via the IdentityRegistry contract. No PII is stored.\n\n` +
    `🔗 Generate your proof at:\n` +
    `\`https://mantleguard.xyz/verify\`\n\n` +
    `Then submit: \`/verify <proof_hash>\``,
    { parse_mode: 'Markdown' }
  );
}

async function handleGas(ctx: Context, wallet: string) {
  const gasBalance = '3.21';
  const feePerTx = '0.002';
  const remainingTxs = Math.floor(3.21 / 0.002);
  const stakingDiscount = 'No (need 10 MNT)';

  await ctx.reply(
    `⛽ *MNT Gas Reserve*\n\n` +
    `Balance: *${gasBalance} MNT*\n` +
    `Fee per TX: ${feePerTx} MNT\n` +
    `Remaining TXs: ~${remainingTxs}\n` +
    `Staking discount: ${stakingDiscount}\n\n` +
    `Deposit more: Send MNT to the GasReserve contract\n` +
    `Min deposit: 0.01 MNT`,
    { parse_mode: 'Markdown' }
  );
}

async function handleHistory(ctx: Context, wallet: string) {
  // Simulated history (production reads from ExecutionRouter events)
  const history = [
    { id: 42, type: '📤', to: 'alice.eth', amount: 50, time: '2h ago', status: '✅' },
    { id: 41, type: '📅', to: 'Netflix', amount: 15, time: '1d ago', status: '✅' },
    { id: 40, type: '📤', to: 'bob.mnt', amount: 200, time: '3d ago', status: '✅' },
  ];

  let msg = `📜 *Recent Transactions*\n\n`;
  for (const tx of history) {
    msg += `${tx.type} #${tx.id} → ${tx.to}: $${tx.amount} mUSD (${tx.time}) ${tx.status}\n`;
  }
  msg += `\nShowing last 3 transactions.`;
  await ctx.reply(msg, { parse_mode: 'Markdown' });
}

async function handleCancel(ctx: Context, wallet: string, params: Record<string, any>) {
  const { scheduleId } = params;
  const keyboard = new InlineKeyboard()
    .text('✅ Yes, cancel it', `confirm_cancel_${scheduleId}`)
    .text('❌ Keep it', 'cancel_action');

  await ctx.reply(
    `🗑️ Cancel schedule #${scheduleId}?\n\nThis will stop all future payments.`,
    { reply_markup: keyboard }
  );
}

async function handleUnknown(ctx: Context, text: string) {
  await ctx.reply(
    `🤔 I didn't understand that. Try:\n\n` +
    `• "Send $50 to alice.eth"\n` +
    `• "Pay Netflix $15 monthly"\n` +
    `• /balance, /tier, /gas, /history\n\n` +
    `Type /help for all commands.`
  );
}

// ─── CALLBACK HANDLERS (Confirmation Buttons) ────────────────

bot.callbackQuery(/^confirm_transfer_/, async (ctx) => {
  await ctx.answerCallbackQuery('Processing...');
  // In production: call ExecutionRouter.executeTransfer()
  await ctx.editMessageText(
    `✅ *Transfer Complete!*\n\nTX Hash: \`0xab3f...c91d\`\nView on Mantle Explorer →`,
    { parse_mode: 'Markdown' }
  );
});

bot.callbackQuery(/^confirm_schedule_/, async (ctx) => {
  await ctx.answerCallbackQuery('Creating schedule...');
  await ctx.editMessageText(
    `✅ *Schedule Created!*\n\nID: #43\nNext execution: April 1, 2026\nMNT reserved for 12 months.`,
    { parse_mode: 'Markdown' }
  );
});

bot.callbackQuery('cancel_action', async (ctx) => {
  await ctx.answerCallbackQuery('Cancelled');
  await ctx.editMessageText('❌ Action cancelled.');
});

// ─── ERROR HANDLING ───────────────────────────────────────────

bot.catch((err) => {
  console.error('Bot error:', err);
});

// ─── START ────────────────────────────────────────────────────

// Webhook mode (production)
if (config.WEBHOOK_URL) {
  bot.api.setWebhook(config.WEBHOOK_URL);
  console.log(`Webhook set: ${config.WEBHOOK_URL}`);
} else {
  // Polling mode (development)
  bot.start();
  console.log('Bot started in polling mode');
}

export { bot };
