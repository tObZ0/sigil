import { createHash, generateKeyPairSync } from "node:crypto";

// Tor v3 onion service keys, made here instead of by tor so the key can be
// generated once on a trusted machine and handed to the container as an
// environment variable: a redeploy keeps the same address.
// Spec: https://spec.torproject.org/rend-spec/encoding-onion-addresses.html

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const SECRET_HEADER = Buffer.concat([Buffer.from("== ed25519v1-secret: type0 =="), Buffer.alloc(3)]);

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function unbase32(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.toLowerCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`not base32: ${ch}`);
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function checksum(pub: Uint8Array): Buffer {
  return createHash("sha3-256")
    .update(Buffer.concat([Buffer.from(".onion checksum"), pub, Buffer.from([3])]))
    .digest()
    .subarray(0, 2);
}

export function onionAddress(pub: Uint8Array): string {
  return base32(Buffer.concat([pub, checksum(pub), Buffer.from([3])])) + ".onion";
}

/** True when the address's checksum and version byte are right. */
export function isValidOnion(address: string): boolean {
  const m = /^([a-z2-7]{56})\.onion$/.exec(address);
  if (!m) return false;
  const raw = unbase32(m[1]!);
  return raw.length === 35 && raw[34] === 3 && checksum(raw.subarray(0, 32)).equals(raw.subarray(32, 34));
}

export interface OnionKey {
  address: string;
  /** Contents of tor's hs_ed25519_secret_key file. */
  secretFile: Buffer;
}

export function generateOnionKey(): OnionKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const seed = Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  // tor stores the expanded key: SHA-512 of the seed, clamped (RFC 8032 §5.1.5).
  const expanded = createHash("sha512").update(seed).digest();
  expanded[0]! &= 248;
  expanded[31]! &= 127;
  expanded[31]! |= 64;
  return { address: onionAddress(pub), secretFile: Buffer.concat([SECRET_HEADER, expanded]) };
}
