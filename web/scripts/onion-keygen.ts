// Makes the onion service key. Run it once, on your own machine:
//
//   npm run onion:keygen                 random address
//   npm run onion:keygen -- tide         address starting with "tide"
//
// Put the printed ONION_SECRET_KEY in Railway's variables, and the address in
// the NEXT_PUBLIC_ONION_ADDRESS build variable. Anyone holding it
// can run a site at your address, so it goes nowhere else.

import { generateOnionKey } from "../src/server/onion";

const prefix = (process.argv[2] ?? "").toLowerCase();
if (!/^[a-z2-7]{0,6}$/.test(prefix)) {
  console.error("A prefix uses only a–z and 2–7, at most 6 characters.");
  process.exit(1);
}
if (prefix.length >= 5) console.error(`A ${prefix.length}-character prefix can take a long while. Ctrl+C to give up.`);

const started = Date.now();
let tries = 0;
let key = generateOnionKey();
while (!key.address.startsWith(prefix)) {
  key = generateOnionKey();
  if (++tries % 200_000 === 0) console.error(`…${tries.toLocaleString()} tries`);
}

console.log(`\n  ${key.address}\n`);
console.log(`ONION_SECRET_KEY=${key.secretFile.toString("base64")}`);
console.log(`NEXT_PUBLIC_ONION_ADDRESS=${key.address}`);
console.error(`\n(${tries + 1} tries, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
