import { randomBytes } from "node:crypto";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * 130 bits of randomness, 26 characters. The order URL is the only key to
 * an order, so it has to be unguessable rather than short.
 */
export function orderId(): string {
  const bytes = randomBytes(17);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.slice(0, 26);
}

export function isOrderId(s: string): boolean {
  return /^[a-z2-7]{26}$/.test(s);
}

const BECH32 = "[qpzry9x8gf2tvdw0s3jn54khce6mua7l]";
const SHIELDED: Record<"main" | "test", RegExp> = {
  main: new RegExp(`^(u1${BECH32}{100,600}|zs1${BECH32}{75})$`),
  test: new RegExp(`^(utest1${BECH32}{100,600}|ztestsapling1${BECH32}{75})$`),
};

/**
 * Shape check for a refund address. Unified addresses can't be fully checked
 * without decoding them, so the order page shows the address back to the
 * user; a refund is sent by hand after a human looks at it anyway.
 */
export function looksShielded(address: string, network: "main" | "test"): boolean {
  return SHIELDED[network].test(address);
}
