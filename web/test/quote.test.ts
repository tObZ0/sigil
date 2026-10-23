import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEther } from "viem";
import { zatToWei } from "../src/server/money";
import { bidForPayment, coverFor, quoteForBid, weiToZat } from "../src/server/quote";

// ZEC at $50, ETH at $2,500: 1 ZEC = 0.02 ETH.
const rate = { zecUsd: 50_000_000n, ethUsd: 2_500_000_000n };
const costs = { feeBps: 100, gas: parseEther("0.0006"), drip: parseEther("0.0003") };

test("weiToZat rounds up, so the payment always covers the cost", () => {
  assert.equal(weiToZat(parseEther("0.02"), rate), 100_000_000n);
  assert.equal(weiToZat(parseEther("0.02") + 1n, rate), 100_000_001n);
  assert.ok(zatToWei(weiToZat(123_456_789n, rate), rate) >= 123_456_789n);
});

test("a quote adds the fee, gas and drip on top of the bid", () => {
  const q = quoteForBid(parseEther("1"), rate, costs);
  assert.equal(q.fee, parseEther("0.01"));
  assert.equal(q.totalWei, parseEther("1.0109"));
  assert.equal(q.zat, weiToZat(parseEther("1.0109"), rate));
});

test("paying the quote buys back the bid that was quoted", () => {
  for (const eth of ["0.002", "0.5", "1", "1.7"]) {
    const bid = parseEther(eth);
    const q = quoteForBid(bid, rate, costs);
    const got = bidForPayment(q.zat, rate, costs)!;
    // Rounding the ZEC up can only add a few wei to the bid, never take any away.
    assert.ok(got.bid >= bid, `${eth}: ${got.bid} < ${bid}`);
    assert.ok(got.bid - bid < 1_000_000_000n, `${eth}: overshoot ${got.bid - bid}`);
  }
});

test("paying less lowers the bid; too little covers nothing", () => {
  const q = quoteForBid(parseEther("1"), rate, costs);
  const half = bidForPayment(q.zat / 2n, rate, costs)!;
  assert.ok(half.bid < parseEther("0.5"));
  assert.equal(bidForPayment(1_000n, rate, costs), null);
});

test("the fee is the agreed share of the bid", () => {
  const got = bidForPayment(500_000_000n, rate, costs)!; // 5 ZEC = 0.1 ETH gross
  assert.equal(got.gross, parseEther("0.1"));
  assert.equal(got.bid + got.fee + got.gas + got.drip, got.gross);
  assert.ok(got.fee * 10_000n >= got.bid * 99n && got.fee * 10_000n <= got.bid * 101n);
});

test("cover is between 25% and 100% of the bid", () => {
  const bid = parseEther("1");
  assert.equal(coverFor(bid, 0), parseEther("0.25"));
  assert.equal(coverFor(bid, 0.999999), parseEther("1"));
  for (let i = 0; i < 50; i++) {
    const c = coverFor(bid, Math.random());
    assert.ok(c >= parseEther("0.25") && c <= bid);
  }
});
