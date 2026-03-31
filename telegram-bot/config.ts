/**
 * MantleGuard Configuration
 * 
 * Environment variables and contract addresses for all components.
 */

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // ─── Telegram ───────────────────────────────
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',

  // ─── Mantle Network ─────────────────────────
  MANTLE_RPC_URL: process.env.MANTLE_RPC_URL || 'https://rpc.mantle.xyz',
  MANTLE_CHAIN_ID: 5000,
  MANTLE_EXPLORER: 'https://explorer.mantle.xyz',

  // ─── Mantle Testnet (for development) ───────
  MANTLE_TESTNET_RPC: process.env.MANTLE_TESTNET_RPC || 'https://rpc.sepolia.mantle.xyz',
  MANTLE_TESTNET_CHAIN_ID: 5003,

  // ─── Contract Addresses (deploy & update) ───
  contracts: {
    identityRegistry: process.env.IDENTITY_REGISTRY || '0x0000000000000000000000000000000000000000',
    spendingPolicy: process.env.SPENDING_POLICY || '0x0000000000000000000000000000000000000000',
    paymentScheduler: process.env.PAYMENT_SCHEDULER || '0x0000000000000000000000000000000000000000',
    subscriptionManager: process.env.SUBSCRIPTION_MANAGER || '0x0000000000000000000000000000000000000000',
    mntGasReserve: process.env.MNT_GAS_RESERVE || '0x0000000000000000000000000000000000000000',
    executionRouter: process.env.EXECUTION_ROUTER || '0x0000000000000000000000000000000000000000',
    treasury: process.env.TREASURY || '0x0000000000000000000000000000000000000000',
    mUSD: process.env.MUSD_TOKEN || '0x0000000000000000000000000000000000000000',
  },

  // ─── Agent Wallet (executor) ────────────────
  AGENT_PRIVATE_KEY: process.env.AGENT_PRIVATE_KEY || '',

  // ─── Scheduler ──────────────────────────────
  SCHEDULER_INTERVAL_MS: parseInt(process.env.SCHEDULER_INTERVAL_MS || '60000'), // 1 minute
  SCHEDULER_BATCH_SIZE: parseInt(process.env.SCHEDULER_BATCH_SIZE || '10'),

  // ─── Security ───────────────────────────────
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_MAX_REQUESTS: 30,
  SESSION_TTL_MS: 3600000, // 1 hour

  // ─── ZK Verifier ───────────────────────────
  ZK_VERIFIER_URL: process.env.ZK_VERIFIER_URL || 'http://localhost:3001/verify',
};
