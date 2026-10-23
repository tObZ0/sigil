"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, custom, http, numberToHex, type Address, type EIP1193Provider, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, IS_LOCAL } from "./chain";

type Injected = { info: { uuid: string; name: string; icon: string; rdns: string }; provider: EIP1193Provider };

type WalletState = {
  account: Address | null;
  wrongChain: boolean;
  wallets: Injected[];
  client: WalletClient | null;
  connect: (w?: Injected) => Promise<void>;
  connectDev: () => void;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  devAvailable: boolean;
};

const Ctx = createContext<WalletState | null>(null);

const LAST = "relay:wallet";
function remember(v: string | null) {
  try {
    if (v) localStorage.setItem(LAST, v);
    else localStorage.removeItem(LAST);
  } catch {}
}
function recall(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

// Hardhat's well-known test account #15. Only ever used against the local chain.
const DEV_KEY = "0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Injected[]>([]);
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [dev, setDev] = useState(false);

  // EIP-6963: every installed wallet announces itself.
  useEffect(() => {
    const seen = new Map<string, Injected>();
    const on = (e: Event) => {
      const d = (e as CustomEvent<Injected>).detail;
      if (!d?.info?.uuid || seen.has(d.info.uuid)) return;
      seen.set(d.info.uuid, d);
      setWallets([...seen.values()]);
    };
    addEventListener("eip6963:announceProvider", on);
    dispatchEvent(new Event("eip6963:requestProvider"));
    return () => removeEventListener("eip6963:announceProvider", on);
  }, []);

  useEffect(() => {
    if (!provider) return;
    const onAccounts = (a: unknown) => setAccount(((a as string[])[0] as Address) ?? null);
    const onChain = (c: unknown) => setChainId(Number(c));
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener("accountsChanged", onAccounts);
      provider.removeListener("chainChanged", onChain);
    };
  }, [provider]);

  const connect = useCallback(async (w?: Injected) => {
    const p = w?.provider ?? (typeof window !== "undefined" ? (window as unknown as { ethereum?: EIP1193Provider }).ethereum : undefined);
    if (!p) throw new Error("No wallet found. Install Rabby or MetaMask.");
    const accounts = (await p.request({ method: "eth_requestAccounts" })) as Address[];
    setDev(false);
    setProvider(p);
    setAccount(accounts[0] ?? null);
    setChainId(Number(await p.request({ method: "eth_chainId" })));
    remember(w?.info.rdns ?? "injected");
  }, []);

  const connectDev = useCallback(() => {
    if (!IS_LOCAL) return;
    setProvider(null);
    setDev(true);
    setAccount(privateKeyToAccount(DEV_KEY).address);
    setChainId(chain.id);
    remember("dev");
  }, []);

  const disconnect = useCallback(() => {
    setProvider(null);
    setDev(false);
    setAccount(null);
    remember(null);
  }, []);

  // Reconnect the wallet used last time, silently: eth_accounts never prompts,
  // it only answers if the site is already allowed.
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (tried || account) return;
    const last = recall();
    if (!last) return;
    const restore = async () => {
      if (last === "dev") {
        if (IS_LOCAL) connectDev();
        return setTried(true);
      }
      const w = wallets.find((x) => x.info.rdns === last);
      const p = w?.provider ?? (last === "injected" ? (window as unknown as { ethereum?: EIP1193Provider }).ethereum : undefined);
      if (!p) return; // its announcement may not have arrived yet
      setTried(true);
      try {
        const accounts = (await p.request({ method: "eth_accounts" })) as Address[];
        if (!accounts[0]) return;
        setProvider(p);
        setAccount(accounts[0]);
        setChainId(Number(await p.request({ method: "eth_chainId" })));
      } catch {}
    };
    const t = setTimeout(restore, 0);
    return () => clearTimeout(t);
  }, [wallets, tried, account, connectDev]);

  const switchChain = useCallback(async () => {
    if (!provider) return;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(chain.id) }] });
    } catch {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: numberToHex(chain.id),
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls.default.http,
            blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined,
          },
        ],
      });
    }
  }, [provider]);

  const client = useMemo<WalletClient | null>(() => {
    if (dev) return createWalletClient({ account: privateKeyToAccount(DEV_KEY), chain, transport: http() });
    if (provider && account) return createWalletClient({ account, chain, transport: custom(provider) });
    return null;
  }, [dev, provider, account]);

  const value: WalletState = {
    account,
    wrongChain: !!account && chainId !== chain.id,
    wallets,
    client,
    connect,
    connectDev,
    disconnect,
    switchChain,
    devAvailable: IS_LOCAL,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
