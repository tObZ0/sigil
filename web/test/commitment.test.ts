import { test } from "node:test";
import assert from "node:assert/strict";
import { commitmentOf } from "../src/lib/tickets";

// Vector computed by RelayLaunchpad.commitmentOf on a local deployment.
// If this breaks, sealed bids from the site can never be revealed.
test("commitment matches the contract", () => {
  const salt = `0x${"ab".repeat(32)}` as const;
  assert.equal(
    commitmentOf(3, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", 1234567890123456789n, salt),
    "0xe267ae0abcd1a21d4f25cb01f0051337a98c573f6742f84e8d6e45f599e9c693",
  );
});
