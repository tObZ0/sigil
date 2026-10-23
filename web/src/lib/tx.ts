"use client";

import { useState } from "react";
import { BaseError, ContractFunctionRevertedError, type Hash } from "viem";
import { publicClient } from "./chain";

const FRIENDLY: Record<string, string> = {
  WrongPhase: "That isn't possible in this phase. Refresh and try again.",
  AlreadySealed: "This wallet already sealed a bid on this launch.",
  NothingSealed: "This wallet has no sealed bid here.",
  BadReveal: "That reveal key doesn't match the sealed bid. Check you're using the right file and wallet.",
  AlreadyDone: "Already done.",
  Slippage: "The price moved past your limit. Try again.",
  BadParams: "Something in the form isn't allowed.",
  TransferFailed: "The ETH transfer failed.",
};

export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      return FRIENDLY[name] ?? (name || revert.shortMessage);
    }
    if (/rejected|denied/i.test(e.shortMessage)) return "You rejected it in your wallet.";
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Runs one transaction: waits for it to land, and keeps a readable status. */
export function useTx() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(label: string, send: () => Promise<Hash>, after?: () => void | Promise<void>) {
    setBusy(label);
    setError(null);
    setDone(null);
    try {
      const hash = await send();
      setBusy(`${label}: confirming…`);
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("The transaction reverted.");
      setDone(label);
      await after?.();
      return true;
    } catch (e) {
      setError(explain(e));
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, done, run, setError };
}
