/**
 * ChatPayAI Agent Engine
 * 
 * Core AI decision-making module. Takes parsed intents and executes
 * the full pipeline: ZK check → policy → gas → execute → confirm.
 */

import { createPublicClient, http, parseAbi, formatUnits, type Address } from 'viem';
import { mantle } from 'viem/chains';
import { config } from './config.js';

// ─── ABI FRAGMENTS ────────────────────────────────────────────

const ROUTER_ABI = parseAbi([
  'function executeTransfer(address sender, address recipient, uint256 amount) returns (uint256)',
  'function getUserExecutions(address user) view returns (uint256[])',
]);

const IDENTITY_ABI = parseAbi([
  'function getUserTier(address user) view returns (uint8)',
  'function canSpend(address user, uint256 amount) view returns (bool, uint256)',
  'function identities(address) view returns (uint8 tier, uint256 proofTimestamp, bytes32 nullifier, uint256 expiresAt, uint256 dailySpent, uint256 lastSpendReset)',
]);

const GAS_ABI = parseAbi([
  'function getEffectiveFee(address user) view returns (uint256)',
  'function hasEnoughGas(address user, uint256 executions) view returns (bool, uint256)',
  'function reserves(address) view returns (uint256 balance, uint256 totalGasUsed, uint256 minBalance, uint256 lastDeduction)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

// ─── CLIENT ───────────────────────────────────────────────────

const client = createPublicClient({
  chain: mantle,
  transport: http(config.MANTLE_RPC_URL),
});

// ─── TYPES ────────────────────────────────────────────────────

export interface TransferRequest {
  sender: Address;
  recipient: Address;
  amount: bigint;        // mUSD in wei
  description?: string;
}

export interface AgentResponse {
  success: boolean;
  message: string;
  data?: Record<string, any>;
  actions?: string[];    // suggested follow-up actions
}

// ─── AGENT ENGINE ─────────────────────────────────────────────

export class AgentEngine {
  
  /**
   * Full transfer pipeline: ZK → Policy → Gas → Execute
   */
  async processTransfer(req: TransferRequest): Promise<AgentResponse> {
    const steps: string[] = [];
    const c = config.contracts;

    // Step 1: Check ZK Identity Tier
    try {
      const tier = await client.readContract({
        address: c.identityRegistry as Address,
        abi: IDENTITY_ABI,
        functionName: 'getUserTier',
        args: [req.sender],
      }) as number;

      const tierNames = ['No Proof', 'Basic ZK', 'Advanced ZK'];
      const tierLimits = [50n * 10n**18n, 500n * 10n**18n, 2n**255n];

      steps.push(`Tier ${tier} (${tierNames[tier]})`);

      // Check if amount exceeds tier limit
      const [canSpend, remaining] = await client.readContract({
        address: c.identityRegistry as Address,
        abi: IDENTITY_ABI,
        functionName: 'canSpend',
        args: [req.sender, req.amount],
      }) as [boolean, bigint];

      if (!canSpend) {
        return {
          success: false,
          message: `❌ Transfer exceeds your Tier ${tier} daily limit.\n` +
                   `Remaining today: $${formatUnits(remaining, 18)}\n` +
                   `Requested: $${formatUnits(req.amount, 18)}`,
          actions: ['Upgrade tier with /upgrade', 'Try a smaller amount'],
        };
      }
      steps.push(`Spending check: ✅ ($${formatUnits(remaining, 18)} remaining)`);
    } catch (e) {
      return { success: false, message: `Identity check failed: ${(e as Error).message}` };
    }

    // Step 2: Verify mUSD Balance
    try {
      const balance = await client.readContract({
        address: c.mUSD as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [req.sender],
      }) as bigint;

      if (balance < req.amount) {
        return {
          success: false,
          message: `❌ Insufficient mUSD balance.\n` +
                   `Balance: $${formatUnits(balance, 18)}\n` +
                   `Needed: $${formatUnits(req.amount, 18)}`,
          actions: ['Deposit mUSD', 'Try a smaller amount'],
        };
      }
      steps.push(`Balance: ✅ ($${formatUnits(balance, 18)} available)`);
    } catch (e) {
      return { success: false, message: `Balance check failed: ${(e as Error).message}` };
    }

    // Step 3: Verify MNT Gas Reserve
    try {
      const [hasGas, deficit] = await client.readContract({
        address: c.mntGasReserve as Address,
        abi: GAS_ABI,
        functionName: 'hasEnoughGas',
        args: [req.sender, 1n],
      }) as [boolean, bigint];

      if (!hasGas) {
        return {
          success: false,
          message: `❌ Insufficient MNT gas reserve.\n` +
                   `Deficit: ${formatUnits(deficit, 18)} MNT\n` +
                   `Deposit MNT to your gas reserve.`,
          actions: ['Deposit MNT to gas reserve'],
        };
      }

      const fee = await client.readContract({
        address: c.mntGasReserve as Address,
        abi: GAS_ABI,
        functionName: 'getEffectiveFee',
        args: [req.sender],
      }) as bigint;

      steps.push(`Gas: ✅ (~${formatUnits(fee, 18)} MNT)`);
    } catch (e) {
      return { success: false, message: `Gas check failed: ${(e as Error).message}` };
    }

    // Step 4: Ready to execute (return confirmation request)
    return {
      success: true,
      message: `✅ Transfer ready!\n\n` +
               `📤 $${formatUnits(req.amount, 18)} mUSD → ${req.recipient}\n\n` +
               `Pre-flight:\n${steps.map(s => `  • ${s}`).join('\n')}`,
      data: {
        sender: req.sender,
        recipient: req.recipient,
        amount: req.amount.toString(),
        steps,
      },
      actions: ['Confirm to execute'],
    };
  }

  /**
   * Get comprehensive account status for a user.
   */
  async getAccountStatus(user: Address): Promise<AgentResponse> {
    const c = config.contracts;

    try {
      // Parallel reads for efficiency
      const [tier, mUSDBalance, gasReserve] = await Promise.all([
        client.readContract({
          address: c.identityRegistry as Address,
          abi: IDENTITY_ABI,
          functionName: 'getUserTier',
          args: [user],
        }),
        client.readContract({
          address: c.mUSD as Address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [user],
        }),
        client.readContract({
          address: c.mntGasReserve as Address,
          abi: GAS_ABI,
          functionName: 'reserves',
          args: [user],
        }),
      ]);

      const tierNames = ['No Proof', 'Basic ZK', 'Advanced ZK'];
      const tierLimits = ['$50/day', '$500/day', 'Unlimited'];
      const [gasBalance, totalGasUsed] = gasReserve as [bigint, bigint, bigint, bigint];

      return {
        success: true,
        message: `Account status for ${user.slice(0, 6)}...${user.slice(-4)}`,
        data: {
          tier: Number(tier),
          tierName: tierNames[Number(tier)],
          tierLimit: tierLimits[Number(tier)],
          mUSDBalance: formatUnits(mUSDBalance as bigint, 18),
          mntGasBalance: formatUnits(gasBalance, 18),
          totalGasUsed: formatUnits(totalGasUsed, 18),
        },
      };
    } catch (e) {
      return { success: false, message: `Failed to fetch status: ${(e as Error).message}` };
    }
  }

  /**
   * Estimate total cost for a scheduled payment series.
   */
  async estimateScheduleCost(
    user: Address,
    amount: bigint,
    frequency: string,
    months: number = 12
  ): Promise<AgentResponse> {
    const c = config.contracts;
    const cycleMap: Record<string, number> = {
      daily: 365, weekly: 52, biweekly: 26, monthly: 12,
    };
    const cycles = (cycleMap[frequency] || 12) * (months / 12);

    try {
      const fee = await client.readContract({
        address: c.mntGasReserve as Address,
        abi: GAS_ABI,
        functionName: 'getEffectiveFee',
        args: [user],
      }) as bigint;

      const totalGas = fee * BigInt(Math.ceil(cycles));
      const totalMUSD = amount * BigInt(Math.ceil(cycles));

      return {
        success: true,
        message: `Schedule estimate (${months} months):`,
        data: {
          frequency,
          totalCycles: Math.ceil(cycles),
          totalMUSD: formatUnits(totalMUSD, 18),
          totalGasMNT: formatUnits(totalGas, 18),
          perCycleFee: formatUnits(fee, 18),
        },
      };
    } catch (e) {
      return { success: false, message: `Estimation failed: ${(e as Error).message}` };
    }
  }
}
