import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import readline from "node:readline";
import { promisify } from "node:util";
import { cfg } from "./config";
import { db, getMeta, setMeta } from "./db";

/*
 * The Zcash side, adapted from Undertow. relay-scanner holds only the viewing
 * key: it derives one shielded address per order (diversifier index = slot)
 * and trial-decrypts every block for payments to them. It can't spend.
 */

/** Deposit address for an order slot. The order pages call this; it never needs the worker. */
export async function depositAddress(slot: bigint): Promise<string> {
  const c = cfg().zcash;
  if (c.mode === "dev") {
    const body = createHash("sha256").update(`relay-dev-${slot}`).digest("hex");
    return `u1devonlydonotpay${body}${body}`.slice(0, 141);
  }
  const { stdout } = await promisify(execFile)(c.scannerBin, ["address", String(slot)], {
    env: { ...process.env, RELAY_UFVK: c.ufvk },
    timeout: 10_000,
  });
  const address = stdout.trim();
  const expected = c.network === "main" ? "u1" : "utest1";
  if (!address.startsWith(expected)) throw new Error(`scanner returned an unexpected address (${address.slice(0, 8)}…)`);
  return address;
}

export interface Watcher {
  start(): Promise<void>;
  /** Latest Zcash height seen, or null before the first report. */
  tip(): bigint | null;
}

type ScannerEvent =
  | { type: "tip"; height: number }
  | { type: "note"; txid: string; action: number; height: number; time: number; index: number; zatoshis: number }
  | { type: "progress"; height: number }
  | { type: "reorg"; rewind_to: number }
  | { type: "address"; id: number; index: number; address: string }
  | { type: "error"; message: string };

// Blocks to rescan when resuming. Payments are stored idempotently, so overlap
// is free, and it covers a crash between a payment and its progress marker.
const RESUME_OVERLAP = 10n;

/**
 * Runs relay-scanner as a child process. The scanner is stateless: the scan
 * height lives in Postgres and is handed back on every (re)start, so a crash
 * on either side costs a few blocks of rescanning and nothing else.
 */
class SidecarWatcher implements Watcher {
  private tipHeight: bigint | null = null;
  // Events apply strictly in order: a progress marker must never be stored
  // before the payments that came ahead of it.
  private queue: Promise<void> = Promise.resolve();

  async start(): Promise<void> {
    await depositAddress(1_000_000n); // fails early on a wrong or missing key
    await this.spawn();
  }

  private async resumeHeight(): Promise<bigint> {
    const stored = await getMeta("scan_height");
    if (stored) {
      const h = BigInt(stored) - RESUME_OVERLAP;
      return h > 0n ? h : 0n;
    }
    const birthday = cfg().zcash.birthday;
    if (!birthday) throw new Error("SCAN_BIRTHDAY is not set: give the block height the viewing key was created at");
    return BigInt(birthday);
  }

  private async spawn(): Promise<void> {
    const from = await this.resumeHeight();
    const c = cfg().zcash;
    const child: ChildProcessWithoutNullStreams = spawn(c.scannerBin, ["--from", String(from)], {
      env: { ...process.env, RELAY_UFVK: c.ufvk },
      stdio: ["pipe", "pipe", "pipe"],
    });

    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let event: ScannerEvent;
      try {
        event = JSON.parse(line);
      } catch {
        console.error(`scanner: unreadable line: ${line.slice(0, 120)}`);
        return;
      }
      this.queue = this.queue.then(() => this.apply(event)).catch((e) => console.error("scanner event failed:", e));
    });
    readline.createInterface({ input: child.stderr }).on("line", (line) => console.log(line));
    child.on("exit", (code) => {
      console.error(`scanner exited (${code}); restarting in 5s`);
      setTimeout(() => this.spawn().catch((e) => console.error("scanner restart failed:", e)), 5_000);
    });
  }

  private async apply(event: ScannerEvent): Promise<void> {
    const sql = db();
    switch (event.type) {
      case "tip":
        this.tipHeight = BigInt(event.height);
        return;
      case "note":
        await sql`
          insert into payments (txid, action, height, block_time, slot, zatoshis)
          values (${event.txid}, ${event.action}, ${event.height}, ${new Date(event.time * 1000)},
                  ${event.index}, ${event.zatoshis})
          on conflict (txid, action) do update
            set height = excluded.height, block_time = excluded.block_time`;
        return;
      case "progress":
        await setMeta("scan_height", event.height);
        return;
      case "reorg":
        await sql`delete from payments where height >= ${event.rewind_to}`;
        await setMeta("scan_height", event.rewind_to - 1);
        return;
      case "error":
        console.error(`scanner: ${event.message}`);
        return;
      default:
        return;
    }
  }

  tip(): bigint | null {
    return this.tipHeight;
  }
}

/**
 * For working without a viewing key: fake addresses, a chain that ticks every
 * 15 seconds, and payments injected with `npm run dev:pay`.
 */
class DevWatcher implements Watcher {
  private height = 0n;

  async start(): Promise<void> {
    this.height = BigInt((await getMeta("dev_tip")) ?? "3100000");
    setInterval(() => {
      this.height += 1n;
      setMeta("dev_tip", this.height).catch(() => {});
    }, 15_000).unref();
  }

  tip(): bigint | null {
    return this.height;
  }
}

export function createWatcher(): Watcher {
  return cfg().zcash.mode === "dev" ? new DevWatcher() : new SidecarWatcher();
}
