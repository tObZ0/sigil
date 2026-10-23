import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true } },
  networks: {
    // Mine every 2s as well as on each tx, so the latest block's timestamp
    // tracks real time the way it does on Robinhood Chain.
    hardhat: { mining: { auto: true, interval: 2000 } },
    // Local chain for the site's dev mode: `npx hardhat node --port 8546`, then deploy:local.
    localhost: { url: "http://127.0.0.1:8546", chainId: 31337 },
    robinhoodTestnet: { url: process.env.TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com", chainId: 46630, accounts },
    robinhoodMainnet: { url: process.env.MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", chainId: 4663, accounts },
  },
  etherscan: {
    apiKey: { robinhoodTestnet: "blockscout", robinhoodMainnet: "blockscout" },
    customChains: [
      { network: "robinhoodTestnet", chainId: 46630, urls: { apiURL: "https://explorer.testnet.chain.robinhood.com/api", browserURL: "https://explorer.testnet.chain.robinhood.com" } },
      { network: "robinhoodMainnet", chainId: 4663, urls: { apiURL: "https://robinhoodchain.blockscout.com/api", browserURL: "https://robinhoodchain.blockscout.com" } },
    ],
  },
  sourcify: { enabled: true },
};

export default config;
