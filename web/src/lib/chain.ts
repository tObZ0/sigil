import { createPublicClient, defineChain, http, type Address } from "viem";

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

export const localChain = defineChain({
  id: 31337,
  name: "Sigil local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8546"] } },
});

export const IS_LOCAL = process.env.NEXT_PUBLIC_RELAY_NETWORK === "local";
export const chain = IS_LOCAL ? localChain : robinhood;
export const RELAY_ADDRESS = (process.env.NEXT_PUBLIC_RELAY_ADDRESS ?? "") as Address;
export const FROM_BLOCK = BigInt(process.env.NEXT_PUBLIC_RELAY_FROM_BLOCK || "0");
export const DEPLOYED = /^0x[0-9a-fA-F]{40}$/.test(RELAY_ADDRESS);

export const publicClient = createPublicClient({ chain, transport: http() });

export const explorer = (path: string) => (chain.blockExplorers ? `${chain.blockExplorers.default.url}/${path}` : null);
