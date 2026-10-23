import { WEI_PER_ETH, ZAT_PER_ZEC, zatToWei, type Rate } from "./money";

/*
 * What a ZEC bidder pays and gets. Pure functions, so the tests can pin them.
 *
 * A ZEC bid has to cover four things in ETH on Robinhood Chain:
 *   bid    the sealed bid itself
 *   fee    Sigil's cut, a share of the bid
 *   gas    for the bidding wallet: seal, reveal, claim, deliver
 *   drip   ETH sent to the bidder with their tokens, so they can move them
 * Cover is Sigil's own ETH, lent for the sealed window and returned at reveal.
 */

export type Costs = { feeBps: number; gas: bigint; drip: bigint };

export type Quote = { bid: bigint; fee: bigint; gas: bigint; drip: bigint; totalWei: bigint; zat: bigint };

/** ETH → zatoshis at `rate`, rounded up so the payment always covers the cost. */
export function weiToZat(wei: bigint, rate: Rate): bigint {
  const num = wei * rate.ethUsd * ZAT_PER_ZEC;
  const den = rate.zecUsd * WEI_PER_ETH;
  return (num + den - 1n) / den;
}

/** The ZEC to send for a bid of `bid` wei. */
export function quoteForBid(bid: bigint, rate: Rate, c: Costs): Quote {
  const fee = (bid * BigInt(c.feeBps)) / 10_000n;
  const totalWei = bid + fee + c.gas + c.drip;
  return { bid, fee, gas: c.gas, drip: c.drip, totalWei, zat: weiToZat(totalWei, rate) };
}

/**
 * The bid a payment actually buys. Whatever arrived is converted at `rate`,
 * gas and drip come off first, and the rest is split into bid + fee. Paying
 * more raises the bid; paying less lowers it. Null if it can't cover the
 * fixed costs at all.
 */
export function bidForPayment(zat: bigint, rate: Rate, c: Costs): Omit<Quote, "zat" | "totalWei"> & { gross: bigint } | null {
  const gross = zatToWei(zat, rate);
  const afterFixed = gross - c.gas - c.drip;
  if (afterFixed <= 0n) return null;
  const bid = (afterFixed * 10_000n) / (10_000n + BigInt(c.feeBps));
  const fee = afterFixed - bid;
  return { bid, fee, gas: c.gas, drip: c.drip, gross };
}

/**
 * Cover for a ZEC bid: between 25% and 100% of the bid, chosen at random, so
 * the deposit on-chain doesn't reveal the bid. `r` is a uniform [0, 1) draw.
 */
export function coverFor(bid: bigint, r: number): bigint {
  const pct = 25n + BigInt(Math.floor(r * 76));
  return (bid * pct) / 100n;
}
