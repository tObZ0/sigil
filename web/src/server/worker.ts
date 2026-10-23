// The relayer's long-running half: watches Zcash for payments and walks paid
// orders through their launch. Run alongside the Next server:
//
//   npm run worker            (dev, with .env.local)
//   node dist/worker.mjs      (production, from the Docker image)

import { advance } from "./bidder";
import { cfg } from "./config";
import { ACTIVE, db, migrate, setMeta, type ZecOrder } from "./db";
import { prune, reconcile } from "./orders";
import { createWatcher } from "./zcash";

const TICK_MS = 5_000;

async function main() {
  const c = cfg();
  await migrate();
  const watcher = createWatcher();
  await watcher.start();
  console.log(`relay worker: zcash ${c.zcash.mode} (${c.zcash.network}net), ${c.zcash.confirmations} confirmations`);

  let lastPrune = 0;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const tip = watcher.tip();
      // The order pages read the tip from here for their confirmation count.
      if (tip !== null) await setMeta("zcash_tip", tip);
      await reconcile(tip);
      const orders = await db()<ZecOrder[]>`
        select * from zec_orders where status in ${db()(ACTIVE)} order by created_at`;
      // One at a time: they share the hot wallet and its nonce.
      for (const o of orders) {
        try {
          await advance(o);
        } catch (e) {
          // Transient (RPC hiccup, gas spike): logged and retried next tick.
          console.error(`order ${o.id} (${o.status}):`, e instanceof Error ? e.message : e);
        }
      }
      if (Date.now() - lastPrune > 3_600_000) {
        await prune();
        lastPrune = Date.now();
      }
    } catch (e) {
      console.error("tick failed:", e);
    } finally {
      busy = false;
    }
  };
  await tick();
  setInterval(tick, TICK_MS);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
