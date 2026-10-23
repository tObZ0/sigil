// Pretend someone paid a ZEC order. Dev mode only: writes a payment row the
// way the scanner would, at the current fake Zcash tip.
//
//   npm run dev:pay -- <order-id> [zec]       (defaults to the full amount)

import { randomBytes } from "node:crypto";
import { cfg } from "../src/server/config";
import { db, getMeta } from "../src/server/db";
import { formatZec, parseZec } from "../src/server/money";

async function main() {
  if (cfg().zcash.mode !== "dev") throw new Error("dev:pay only works with ZCASH_MODE=dev");
  const [id, amount] = process.argv.slice(2);
  const sql = db();
  const [order] = await sql<{ slot: bigint; zat_requested: bigint }[]>`select slot, zat_requested from zec_orders where id = ${id ?? ""}`;
  if (!order) throw new Error("usage: npm run dev:pay -- <order-id> [zec]");
  const zat = amount ? parseZec(amount) : order.zat_requested;
  if (zat === null) throw new Error(`bad amount ${amount}`);
  const tip = BigInt((await getMeta("dev_tip")) ?? "3100000");
  await sql`
    insert into payments (txid, action, height, block_time, slot, zatoshis)
    values (${randomBytes(32).toString("hex")}, 0, ${tip}, now(), ${order.slot}, ${zat})`;
  console.log(`Paid ${formatZec(zat)} ZEC to ${id} at height ${tip}. It confirms as the fake chain ticks (every 15s).`);
  await sql.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
