/**
 * ChatPayAI — Full Contract Deployment Script
 * 
 * Deploys all 7 contracts to Mantle in correct dependency order,
 * configures roles, and links contracts together.
 * 
 * Usage: npx hardhat run scripts/deploy.ts --network mantle
 */

import { ethers, upgrades } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('═══════════════════════════════════════════');
  console.log('  ChatPayAI — Contract Deployment');
  console.log('═══════════════════════════════════════════');
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Network:   ${(await ethers.provider.getNetwork()).name}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MNT`);
  console.log('───────────────────────────────────────────\n');

  // ─── 1. Deploy IdentityRegistry ─────────────────────────────
  console.log('1/7  Deploying IdentityRegistry...');
  const IdentityRegistry = await ethers.getContractFactory('IdentityRegistry');
  const identityRegistry = await upgrades.deployProxy(
    IdentityRegistry,
    [deployer.address],
    { kind: 'uups' }
  );
  await identityRegistry.waitForDeployment();
  const identityAddr = await identityRegistry.getAddress();
  console.log(`     ✅ IdentityRegistry: ${identityAddr}`);

  // ─── 2. Deploy SpendingPolicy ───────────────────────────────
  console.log('2/7  Deploying SpendingPolicy...');
  const SpendingPolicy = await ethers.getContractFactory('SpendingPolicy');
  const spendingPolicy = await upgrades.deployProxy(
    SpendingPolicy,
    [deployer.address, identityAddr],
    { kind: 'uups' }
  );
  await spendingPolicy.waitForDeployment();
  const policyAddr = await spendingPolicy.getAddress();
  console.log(`     ✅ SpendingPolicy:   ${policyAddr}`);

  // ─── 3. Deploy MNTGasReserve ────────────────────────────────
  console.log('3/7  Deploying MNTGasReserve...');
  const MNTGasReserve = await ethers.getContractFactory('MNTGasReserve');
  const gasReserve = await upgrades.deployProxy(
    MNTGasReserve,
    [deployer.address],
    { kind: 'uups' }
  );
  await gasReserve.waitForDeployment();
  const gasAddr = await gasReserve.getAddress();
  console.log(`     ✅ MNTGasReserve:   ${gasAddr}`);

  // ─── 4. Deploy mUSD mock (testnet only) ─────────────────────
  // On mainnet, use the actual mUSD token address
  console.log('4/7  Deploying mUSD mock (testnet)...');
  const MockERC20 = await ethers.getContractFactory('MockERC20');
  const mUSD = await MockERC20.deploy('Mantle USD', 'mUSD', 18);
  await mUSD.waitForDeployment();
  const mUSDAddr = await mUSD.getAddress();
  console.log(`     ✅ mUSD (mock):     ${mUSDAddr}`);

  // ─── 5. Deploy PaymentScheduler ─────────────────────────────
  console.log('5/7  Deploying PaymentScheduler...');
  const PaymentScheduler = await ethers.getContractFactory('PaymentScheduler');
  const scheduler = await upgrades.deployProxy(
    PaymentScheduler,
    [deployer.address, mUSDAddr],
    { kind: 'uups' }
  );
  await scheduler.waitForDeployment();
  const schedulerAddr = await scheduler.getAddress();
  console.log(`     ✅ PaymentScheduler: ${schedulerAddr}`);

  // ─── 6. Deploy SubscriptionManager ──────────────────────────
  console.log('6/7  Deploying SubscriptionManager...');
  const SubscriptionManager = await ethers.getContractFactory('SubscriptionManager');
  const subManager = await upgrades.deployProxy(
    SubscriptionManager,
    [deployer.address, mUSDAddr],
    { kind: 'uups' }
  );
  await subManager.waitForDeployment();
  const subAddr = await subManager.getAddress();
  console.log(`     ✅ SubscriptionMgr: ${subAddr}`);

  // ─── 7. Deploy ExecutionRouter ──────────────────────────────
  console.log('7/7  Deploying ExecutionRouter...');
  const ExecutionRouter = await ethers.getContractFactory('ExecutionRouter');
  const router = await upgrades.deployProxy(
    ExecutionRouter,
    [deployer.address, mUSDAddr, policyAddr, gasAddr],
    { kind: 'uups' }
  );
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log(`     ✅ ExecutionRouter: ${routerAddr}`);

  // ─── 8. Deploy Treasury ─────────────────────────────────────
  console.log('+    Deploying Treasury...');
  const Treasury = await ethers.getContractFactory('Treasury');
  const treasury = await upgrades.deployProxy(
    Treasury,
    [deployer.address, mUSDAddr],
    { kind: 'uups' }
  );
  await treasury.waitForDeployment();
  const treasuryAddr = await treasury.getAddress();
  console.log(`     ✅ Treasury:        ${treasuryAddr}`);

  // ─── ROLE CONFIGURATION ─────────────────────────────────────
  console.log('\n───────────────────────────────────────────');
  console.log('  Configuring roles & permissions...');
  console.log('───────────────────────────────────────────');

  const VERIFIER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('VERIFIER_ROLE'));
  const EXECUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('EXECUTOR_ROLE'));
  const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('AGENT_ROLE'));

  // SpendingPolicy needs VERIFIER_ROLE on IdentityRegistry (to call recordSpend)
  await identityRegistry.grantRole(VERIFIER_ROLE, policyAddr);
  console.log('  ✅ SpendingPolicy → VERIFIER on IdentityRegistry');

  // ExecutionRouter needs EXECUTOR_ROLE on SpendingPolicy
  await spendingPolicy.grantRole(EXECUTOR_ROLE, routerAddr);
  console.log('  ✅ ExecutionRouter → EXECUTOR on SpendingPolicy');

  // ExecutionRouter needs EXECUTOR_ROLE on MNTGasReserve
  await gasReserve.grantRole(EXECUTOR_ROLE, routerAddr);
  console.log('  ✅ ExecutionRouter → EXECUTOR on MNTGasReserve');

  // Scheduler bot needs EXECUTOR_ROLE on PaymentScheduler
  await scheduler.grantRole(EXECUTOR_ROLE, deployer.address);
  console.log('  ✅ Deployer → EXECUTOR on PaymentScheduler');

  // Scheduler bot needs EXECUTOR_ROLE on SubscriptionManager
  await subManager.grantRole(EXECUTOR_ROLE, deployer.address);
  console.log('  ✅ Deployer → EXECUTOR on SubscriptionManager');

  // Agent backend needs AGENT_ROLE on ExecutionRouter
  await router.grantRole(AGENT_ROLE, deployer.address);
  console.log('  ✅ Deployer → AGENT on ExecutionRouter');

  // ─── SUMMARY ────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log('  DEPLOYMENT COMPLETE');
  console.log('═══════════════════════════════════════════');
  
  const addresses = {
    IdentityRegistry: identityAddr,
    SpendingPolicy: policyAddr,
    MNTGasReserve: gasAddr,
    mUSD: mUSDAddr,
    PaymentScheduler: schedulerAddr,
    SubscriptionManager: subAddr,
    ExecutionRouter: routerAddr,
    Treasury: treasuryAddr,
  };

  console.log('\n  Contract Addresses:');
  for (const [name, addr] of Object.entries(addresses)) {
    console.log(`    ${name.padEnd(22)} ${addr}`);
  }

  console.log('\n  .env format:');
  console.log(`    IDENTITY_REGISTRY=${identityAddr}`);
  console.log(`    SPENDING_POLICY=${policyAddr}`);
  console.log(`    MNT_GAS_RESERVE=${gasAddr}`);
  console.log(`    MUSD_TOKEN=${mUSDAddr}`);
  console.log(`    PAYMENT_SCHEDULER=${schedulerAddr}`);
  console.log(`    SUBSCRIPTION_MANAGER=${subAddr}`);
  console.log(`    EXECUTION_ROUTER=${routerAddr}`);
  console.log(`    TREASURY=${treasuryAddr}`);

  return addresses;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
