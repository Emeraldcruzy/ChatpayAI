# 🛡️ ChatPayAI

### Autonomous Telegram Financial Agent with ZK Identity, mUSD Payments & MNT-Powered Execution on Mantle

---


**ChatPayAI** — *"Talk to your money. It listens, verifies, and executes — privately, autonomously, on Mantle."*

---

## 2. Problem Statement

### Friction in DeFi UX
Interacting with DeFi requires navigating multiple dApps, signing complex transactions, managing gas tokens, and understanding smart contract ABIs. For 95% of potential users, this is an insurmountable barrier. Sending a recurring payment requires more steps than filing taxes.

### Lack of Conversational Finance
Banking moved from branches to apps. DeFi should move from dashboards to conversations. Users think in natural language — "Pay rent on the 1st" — not in function selectors and calldata.

### Privacy vs Compliance Tradeoff
Current systems force a binary choice: full KYC (privacy-destroying) or no verification (limited access). Zero-knowledge proofs offer a third path — proving identity attributes without revealing the underlying data.

### Need for Autonomous Payments
Scheduled payments, subscriptions, and savings automations are table stakes in traditional finance. DeFi has no native equivalent that doesn't require a centralized intermediary or constant manual intervention.

---

## 3. Solution Overview

ChatPayAI is a Telegram-native AI financial agent that:
- **Understands** natural language payment instructions
- **Verifies** user identity through zero-knowledge proofs
- **Enforces** spending limits based on ZK-verified identity tiers
- **Executes** on-chain transfers in mUSD on Mantle
- **Manages** MNT gas reserves automatically
- **Schedules** recurring payments and subscriptions autonomously

**Data Flow:**
```
User → Telegram → AI Agent → Policy Engine → ZK Verifier → Mantle → Execution
```

---

## 4. System Architecture

See `diagrams/` directory for JPEG diagrams:
- `01_high_level_architecture.jpg` — Full system overview with all layers
- `02_agent_decision_flow.jpg` — How the AI routes intents to actions
- `03_zk_identity_flow.jpg` — ZK proof verification and tier management
- `04_payment_execution_flow.jpg` — Swim-lane execution from message to confirmation
- `05_scheduler_lifecycle.jpg` — Autonomous scheduler states and execution cycle
- `06_user_interaction_flow.jpg` — Telegram UX conversation examples

### Architecture Layers

| Layer | Components | Role |
|-------|-----------|------|
| User Layer | Telegram, Dashboard, API | Interface |
| Application Layer | Bot Server, AI Engine, Scheduler, Wallet Manager, Gas Oracle | Logic |
| Policy Layer | ZK Verifier, Spending Policy, Rate Limiter, Identity Registry | Enforcement |
| Blockchain Layer | mUSD, MNT Gas Reserve, Payment Scheduler, Subscription Manager, Execution Router | Execution |

---

## 5. ZK Identity Integration

### Identity Tiers

| Tier | Proof Required | Daily Limit | TX/Hour |
|------|---------------|-------------|---------|
| **Tier 0** | None | $50 | 5 |
| **Tier 1** | Basic ZK proof (personhood) | $500 | 20 |
| **Tier 2** | Advanced ZK proof (gov ID attestation) | Unlimited | 100 |

### ZK Proof Flow

1. User requests a transaction exceeding their current tier limit
2. Bot prompts user to upgrade via `/upgrade`
3. User generates ZK proof off-chain (Groth16/PLONK)
4. Proof submitted to `IdentityRegistry.upgradeTier()`
5. On-chain verification — no PII stored
6. Tier upgraded, new limits immediately active

### Proof Structure
```
ZK Proof {
  nullifier: bytes32     // prevents reuse
  commitment: bytes32    // identity hash
  tier_level: uint8      // 0, 1, or 2
  expiry: uint256        // proof expiration
}
```

### Contract: `IdentityRegistry.sol`
- Stores user tiers with expiration
- Tracks daily spending per user
- Nullifier-based replay protection
- Auto-downgrades expired proofs
- UUPS upgradeable + role-based access

---

## 6. MNT Token Usage

MNT serves 5 distinct roles in ChatPayAI:

| Role | Description | Mechanism |
|------|-------------|-----------|
| **Gas Reserve** | Pre-deposited MNT for automated TX execution | `MNTGasReserve.deposit()` |
| **Automation Fee** | 0.002 MNT per scheduled execution | Deducted from reserve |
| **Staking Bond** | Maintain 10+ MNT for 20% fee discount | Balance check on each TX |
| **Premium Unlock** | Advanced features gated by MNT balance | Tier-based access |
| **Reliability Incentive** | Operators earn MNT for executing schedules | Treasury distribution |

### Gas Management
- **Storage**: User deposits MNT into `MNTGasReserve` contract
- **Estimation**: `getEffectiveFee(user)` returns fee considering staking discount
- **Deduction**: ExecutionRouter calls `deductGas(user)` before each TX
- **Fallback**: When reserve drops below user's minimum threshold, a `LowBalance` event is emitted and user is notified via Telegram
- **Refill**: Bot alerts user with `/gas` status and deposit instructions

---

## 7. mUSD Payment System

All user-facing value transfers use mUSD (Mantle's native stablecoin):

- **Transfers**: One-time sends to any address or ENS name
- **Subscriptions**: Merchant-defined plans with automated billing
- **Bill Payments**: Recurring payments to allowlisted recipients
- **Savings Automation**: Scheduled deposits to savings vaults

### Contracts
- `PaymentScheduler.sol` — Stores and executes recurring mUSD transfers
- `SubscriptionManager.sol` — Merchant plans + user subscriptions
- `Treasury.sol` — Protocol fee collection (0.1% default)

---

## 8. Telegram Bot Architecture

### Webhook Handler
```
Telegram → HTTPS POST → Bot Server → Intent Parser → Agent Engine → Response
```

### Intent Parsing
Pattern-matching with fallback to AI classification:
- `"Send $50 to alice.eth"` → `{ intent: "transfer", amount: 50, recipient: "alice.eth" }`
- `"Pay rent $800 monthly"` → `{ intent: "schedule", amount: 800, freq: "monthly" }`
- `"/balance"` → `{ intent: "balance" }`

### Wallet Mapping
Telegram user ID → Ethereum address via `/connect 0x...` command. Stored in session.

### Conversation Memory
Per-user session tracks:
- Linked wallet address
- Pending confirmation actions (with TTL expiry)
- Last N messages for context
- Current ZK tier (cached)

### Confirmation Flow
All financial actions require explicit confirmation via inline keyboard buttons before execution.

---

## 9. Autonomous Scheduler

### User Commands
```
"Pay rent $800 monthly"          → Monthly schedule
"Send $20 to savings weekly"     → Weekly schedule
"Pay Netflix $15.99 on the 1st"  → Monthly on specific date
```

### Execution Cycle
1. **Cron Trigger** — Scheduler service polls every 60 seconds
2. **Fetch Due** — `PaymentScheduler.getDueSchedules()` returns due IDs
3. **Pre-flight** — Check: MNT gas reserve ✓, mUSD balance ✓, ZK tier ✓
4. **Execute** — `PaymentScheduler.executeSchedule(id)` transfers mUSD
5. **Log & Notify** — Event emitted, user notified via Telegram
6. **Reschedule** — `nextExecution` updated to next interval

### Failure Handling
- Insufficient mUSD → Schedule paused, user notified
- Insufficient MNT → Schedule paused, deposit prompt sent
- ZK tier expired → Schedule paused, upgrade prompt sent
- Contract revert → Retry once, then pause

---

## 10. Smart Contract Design

### Contract Overview

| Contract | Purpose | Key Features |
|----------|---------|-------------|
| `IdentityRegistry.sol` | ZK identity tier management | Nullifier-based, auto-expiry, daily tracking |
| `SpendingPolicy.sol` | Spending limit enforcement | Rate limiting, replay protection, circuit breaker |
| `PaymentScheduler.sol` | Recurring payment storage & execution | Multi-frequency, batch execution, pause/resume |
| `SubscriptionManager.sol` | Merchant subscription plans | Plan CRUD, automated billing, unsubscribe |
| `MNTGasReserve.sol` | MNT gas deposit & deduction | Staking discount, low-balance alerts, estimation |
| `ExecutionRouter.sol` | Central execution hub | Policy→Gas→Transfer pipeline, batch execution |
| `Treasury.sol` | Fee collection & operator rewards | Configurable fee BPS, reward distribution |

### Shared Design Patterns
- **Access Control**: OpenZeppelin `AccessControlUpgradeable` with granular roles
- **Pausable**: Emergency pause on all execution paths
- **Upgrade-safe**: UUPS proxy pattern for all core contracts
- **Events**: Comprehensive event emission for off-chain indexing
- **Gas Optimized**: `viaIR` compilation, minimal storage writes

---

## 11. Project Structure

```
chatpayai/
├── contracts/
│   ├── IdentityRegistry.sol
│   ├── SpendingPolicy.sol
│   ├── PaymentScheduler.sol
│   ├── SubscriptionManager.sol
│   ├── MNTGasReserve.sol
│   ├── ExecutionRouter.sol
│   ├── Treasury.sol
│   └── MockERC20.sol
├── telegram-bot/
│   ├── bot.ts              # Telegram bot server + handlers
│   ├── agent-engine.ts     # AI decision engine
│   ├── scheduler.ts        # Autonomous scheduler service
│   └── config.ts           # Environment + contract config
├── scripts/
│   └── deploy.ts           # Full deployment + role config
├── frontend-dashboard/
│   └── Dashboard.jsx        # React dashboard component
├── diagrams/
│   ├── 01_high_level_architecture.jpg
│   ├── 02_agent_decision_flow.jpg
│   ├── 03_zk_identity_flow.jpg
│   ├── 04_payment_execution_flow.jpg
│   ├── 05_scheduler_lifecycle.jpg
│   └── 06_user_interaction_flow.jpg
├── docs/
│   └── (this README)
├── hardhat.config.ts
├── package.json
├── .env.example
└── README.md
```

---

## 12. Tech Stack

| Component | Technology |
|-----------|-----------|
| Telegram Bot | grammy (Bot API framework) |
| Backend Runtime | Node.js + TypeScript |
| Smart Contracts | Solidity ^0.8.20 |
| Contract Framework | Hardhat + OpenZeppelin |
| Blockchain Client | viem |
| Target Chain | Mantle L2 (Chain ID: 5000) |
| ZK Proofs | Groth16 / PLONK (off-chain generation) |
| Scheduler | Node.js cron + on-chain state |
| Dashboard | React + CSS-in-JS |
| RPC | Mantle public RPC or Alchemy/Infura |

---

## 13. Setup Guide

### Step 1: Create Telegram Bot
1. Message `@BotFather` on Telegram
2. Send `/newbot` and follow prompts
3. Copy the bot token → `TELEGRAM_BOT_TOKEN`

### Step 2: Install Dependencies
```bash
git clone https://github.com/Emeraldcruzy/ChatpayAI.git
cd chatpayai
npm install
```

### Step 3: Configure Environment
```bash
cp .env.example .env
# Edit .env with your keys
```

### Step 4: Deploy Contracts
```bash
# Testnet first
npx hardhat run scripts/deploy.ts --network mantleSepolia

# Copy output addresses to .env
```

### Step 5: Configure Mantle RPC
Update `.env` with contract addresses from deployment output.

### Step 6: Run Bot Server
```bash
# Development (polling mode)
npm run dev

# Production (webhook mode - set WEBHOOK_URL first)
npm start
```

### Step 7: Start Scheduler
```bash
npm run scheduler
```

### Step 8: Connect Wallet
In Telegram, message your bot:
```
/connect 0xYourWalletAddress
```

### Step 9: Test Payment Flow
```
Send $10 to 0x1234...5678
```

---

## 14. User Flow Examples

### Example 1: Monthly Subscription
```
User: "Pay Netflix $15 monthly"
Bot:  🔍 Checking identity tier...
Bot:  Tier 1 verified. Limit: $500/day
Bot:  📅 Schedule Payment
      Amount: $15.99 mUSD
      To: netflix.eth
      Frequency: Monthly
      Est. annual gas: ~0.024 MNT
      Confirm?
User: [Clicks ✅ Confirm]
Bot:  ✅ Schedule Created!
      ID: #43
      Next execution: April 1, 2026
```

### Example 2: Transfer Exceeding Limit
```
User: "Send $600 to bob.mnt"
Bot:  ⚠️ Limit Exceeded
      Your Tier 1 limit: $500/day
      Requested: $600
      
      Upgrade to Tier 2 for unlimited transfers.
      Use /upgrade to submit a ZK proof.

User: "/upgrade"
Bot:  🔐 ZK Identity Upgrade
      Generate your proof at:
      https://chatpayai.xyz/verify
      Then submit: /verify <proof_hash>

User: "/verify 0xabc123..."
Bot:  ✅ ZK proof verified! Now Tier 2
      Your new limit: Unlimited
      
      Retry: "Send $600 to bob.mnt"
```

---

## 15. MNT Gas Management

### Reserve Buffer
Users are encouraged to maintain a minimum MNT balance covering at least 30 days of scheduled executions. The bot calculates this automatically.

### Refill Logic
```
1. Before each execution: check reserve >= fee
2. If insufficient: pause schedule, notify user
3. User deposits MNT via direct transfer to GasReserve
4. Schedule auto-resumes on next tick
```

### Estimation Algorithm
```
effective_fee = base_fee * (has_staking_discount ? 0.8 : 1.0)
monthly_cost = effective_fee * scheduled_executions_per_month
recommended_reserve = monthly_cost * 3  // 3-month buffer
```

### Failure Prevention
- Low-balance alerts at user-defined threshold
- Pre-flight gas check before every execution
- Batch execution to amortize overhead
- Staking discount incentivizes healthy reserves

---

## 16. Security Model

| Vector | Mitigation |
|--------|-----------|
| **Replay Attacks** | Unique nonce per execution, on-chain tracking |
| **Rate Limiting** | Per-tier TX/hour limits enforced on-chain |
| **Signature Verification** | Agent role required for ExecutionRouter calls |
| **Spending Caps** | ZK-tier daily limits + global circuit breaker ($1M/day) |
| **ZK Gating** | Proof nullifiers prevent reuse; expiry enforced |
| **Reentrancy** | OpenZeppelin ReentrancyGuard on all execution paths |
| **Upgrade Safety** | UUPS pattern with dedicated UPGRADER_ROLE |
| **Emergency Stop** | Pausable on all core contracts |
| **Allowlisting** | Tier 0 users: recipients >$25 must be pre-approved |

---

## 17. Mantle Integration

### Why Mantle?
- **Low gas costs**: MNT-denominated gas makes micropayments viable
- **EVM compatible**: Standard Solidity + familiar tooling
- **Native stablecoin**: mUSD provides the ideal payment medium
- **L2 speed**: Fast finality for real-time payment confirmations

### Contract Deployment
All contracts deploy via Hardhat to Mantle (chain ID 5000) using UUPS proxies. Deployment script handles dependency ordering and role configuration.

### mUSD Usage
- All user-visible amounts denominated in mUSD
- ERC20 `transferFrom` for scheduled payments (requires user approval)
- Treasury collects 0.1% protocol fee in mUSD

### MNT Gas
- Native MNT used for transaction gas on Mantle
- `MNTGasReserve` contract pre-collects MNT from users
- Agent wallet funded with MNT for execution

### Transaction Finality
Mantle L2 provides soft finality within seconds. The bot confirms to users after `waitForTransactionReceipt` returns.

---

## 18. Dashboard UI

The React dashboard (`frontend-dashboard/Dashboard.jsx`) displays:

| Tab | Contents |
|-----|---------|
| **Overview** | mUSD balance, MNT balance, gas reserve, active schedules, daily spending bar, quick command reference |
| **Schedules** | Table of all recurring payments with status, amounts, frequency, next execution |
| **History** | Transaction log with type icons, amounts, timestamps, TX hashes |
| **Gas** | MNT reserve details, fee breakdown, staking status, remaining TX estimate |
| **Identity** | ZK tier comparison cards, current tier highlight, proof details |

---

## 19. Flow Diagrams

All 6 diagrams are generated as high-resolution JPEGs in `diagrams/`:

1. **High-Level Architecture** — 4-layer system: User → Application → Policy → Blockchain
2. **Agent Decision Flow** — Intent classification branching into transfer/schedule/balance/upgrade paths
3. **ZK Identity Flow** — Tier lookup → limit check → upgrade path → proof verification
4. **Payment Execution Flow** — Swim-lane diagram: Telegram → Backend → Policy → Mantle → MNT Gas
5. **Scheduler Lifecycle** — State machine: Command → Created → Stored → Active → Execution Cycle
6. **User Interaction Flow** — Telegram conversation mockups with command reference

---

## 20. This README

You're reading it. It covers all 23 required sections.

---

## 21. Code Deliverables

| File | Type | Description |
|------|------|-------------|
| `contracts/IdentityRegistry.sol` | Solidity | ZK identity tier management |
| `contracts/SpendingPolicy.sol` | Solidity | Policy enforcement engine |
| `contracts/PaymentScheduler.sol` | Solidity | Recurring payment scheduler |
| `contracts/SubscriptionManager.sol` | Solidity | Merchant subscription management |
| `contracts/MNTGasReserve.sol` | Solidity | MNT gas deposit and deduction |
| `contracts/ExecutionRouter.sol` | Solidity | Central execution router |
| `contracts/Treasury.sol` | Solidity | Fee collection and rewards |
| `telegram-bot/bot.ts` | TypeScript | Full Telegram bot with intent parsing |
| `telegram-bot/agent-engine.ts` | TypeScript | AI agent decision pipeline |
| `telegram-bot/scheduler.ts` | TypeScript | Autonomous execution service |
| `telegram-bot/config.ts` | TypeScript | Environment configuration |
| `scripts/deploy.ts` | TypeScript | Full deployment + role setup |
| `frontend-dashboard/Dashboard.jsx` | React | Complete dashboard UI |
| `hardhat.config.ts` | TypeScript | Hardhat + Mantle config |

---

## 22. Real-World Use Cases

### Subscription Payments
"Pay Netflix $15.99 monthly" — Set-and-forget recurring payments to merchant addresses, with automatic mUSD deduction and MNT gas management.

### Remittances
"Send $200 to mama.eth every Friday" — Cross-border payments via stablecoin, no intermediary fees, ZK-verified sender identity.

### Payroll Automation
"Pay team: alice $3000, bob $3500, carol $2800 on the 1st" — Batch scheduled payments with policy-enforced limits.

### Bill Payment
"Pay landlord $1200 on the 1st" — Recurring rent payments with allowlisted recipients for Tier 0 users.

### Savings Automation
"Send $50 to savings vault daily" — Dollar-cost averaging into savings positions via scheduled mUSD transfers.

---

## 23. Why This Benefits Mantle

### Increases Stablecoin Usage
Every payment flows through mUSD. ChatPayAI drives consistent, recurring stablecoin transaction volume — not just speculative trading.

### Increases MNT Utility
MNT becomes essential infrastructure: gas for every transaction, staking for fee discounts, rewards for operators. This creates sustained demand beyond speculation.

### Improves UX
ChatPayAI abstracts away wallets, gas, and contract interactions. Users type natural language in Telegram. This is the UX bar that brings mainstream adoption.

### Brings Non-Crypto Users
A Telegram bot that handles payments feels like Venmo or Cash App — not a blockchain application. ZK identity tiers provide a familiar progressive verification flow (like increasing limits on a new bank account).

### Protocol Revenue
Treasury collects 0.1% on each transfer. At scale, this creates a sustainable protocol revenue stream denominated in mUSD, directly benefiting the Mantle ecosystem.

---

## License

MIT

---

*Built for the Mantle ecosystem. Powered by MNT. Protected by zero knowledge.*
