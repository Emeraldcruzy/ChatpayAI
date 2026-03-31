import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import dotenv from 'dotenv';

dotenv.config();

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '0x' + '0'.repeat(64);

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    mantle: {
      url: 'https://rpc.mantle.xyz',
      chainId: 5000,
      accounts: [DEPLOYER_KEY],
    },
    mantleSepolia: {
      url: 'https://rpc.sepolia.mantle.xyz',
      chainId: 5003,
      accounts: [DEPLOYER_KEY],
    },
    hardhat: {
      forking: {
        url: 'https://rpc.mantle.xyz',
        enabled: false,
      },
    },
  },
  etherscan: {
    apiKey: {
      mantle: process.env.MANTLE_EXPLORER_API_KEY || '',
    },
    customChains: [
      {
        network: 'mantle',
        chainId: 5000,
        urls: {
          apiURL: 'https://api.mantlescan.xyz/api',
          browserURL: 'https://mantlescan.xyz',
        },
      },
    ],
  },
};

export default config;
