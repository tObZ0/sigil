import { parseAbiItem, type Address } from "viem";
import { relayAbi } from "./abi";
import { FROM_BLOCK, publicClient, RELAY_ADDRESS } from "./chain";

export const PHASES = ["sealing", "revealing", "settling", "live", "failed"] as const;
export type Phase = (typeof PHASES)[number];

export const SALE_SUPPLY = 500_000_000n * 10n ** 18n;
export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

export type Meta = { description: string; image: string; x: string; telegram: string; website: string };

export type Launch = {
  id: number;
  token: Address;
  creator: Address;
  name: string;
  symbol: string;
  meta: Meta;
  sealEnd: number;
  revealEnd: number;
  minRaise: bigint;
  deposits: bigint;
  raised: bigint;
  bidders: number;
  reveals: number;
  phase: Phase;
  ethReserve: bigint;
  tokenReserve: bigint;
};

export type Bid = { commitment: `0x${string}`; deposit: bigint; amount: bigint; revealed: boolean; claimed: boolean };

const created = parseAbiItem(
  "event LaunchCreated(uint256 indexed id, address indexed token, address indexed creator, string name, string symbol, string meta, uint64 sealEnd, uint64 revealEnd, uint256 minRaise)",
);

function parseMeta(raw: string): Meta {
  const empty = { description: "", image: "", x: "", telegram: "", website: "" };
  try {
    const m = JSON.parse(raw) as Partial<Meta>;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    // Only data-URI images: a launch can't make every visitor fetch a tracking pixel.
    const image = str(m.image, 30_000);
    return {
      description: str(m.description, 400),
      image: /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(image) ? image : "",
      x: str(m.x, 200),
      telegram: str(m.telegram, 200),
      website: str(m.website, 200),
    };
  } catch {
    return empty;
  }
}

/** Chain time, not wall time: phases follow block timestamps. */
export async function chainNow(): Promise<number> {
  const b = await publicClient.getBlock({ blockTag: "latest" });
  return Number(b.timestamp);
}

type RawLaunch = {
  token: Address;
  creator: Address;
  sealEnd: bigint;
  revealEnd: bigint;
  minRaise: bigint;
  deposits: bigint;
  revealedDeposits: bigint;
  raised: bigint;
  bidders: number;
  reveals: number;
  settled: boolean;
  failed: boolean;
  ethReserve: bigint;
  tokenReserve: bigint;
};

const names = new Map<number, { name: string; symbol: string; meta: Meta; block: bigint }>();
const createdAt = new Map<number, number>();

async function loadNames(ids: number[]) {
  const missing = ids.filter((i) => !names.has(i));
  if (!missing.length) return;
  const logs = await publicClient.getLogs({ address: RELAY_ADDRESS, event: created, fromBlock: FROM_BLOCK, toBlock: "latest" });
  for (const l of logs) {
    const a = l.args;
    names.set(Number(a.id), { name: a.name ?? "", symbol: a.symbol ?? "", meta: parseMeta(a.meta ?? ""), block: l.blockNumber });
  }
}

function toLaunch(id: number, raw: RawLaunch, phase: number): Launch {
  const n = names.get(id) ?? { name: `Launch #${id}`, symbol: "?", meta: parseMeta(""), block: 0n };
  return {
    id,
    token: raw.token,
    creator: raw.creator,
    name: n.name,
    symbol: n.symbol,
    meta: n.meta,
    sealEnd: Number(raw.sealEnd),
    revealEnd: Number(raw.revealEnd),
    minRaise: raw.minRaise,
    deposits: raw.deposits,
    raised: raw.raised,
    bidders: Number(raw.bidders),
    reveals: Number(raw.reveals),
    phase: PHASES[phase] ?? "sealing",
    ethReserve: raw.ethReserve,
    tokenReserve: raw.tokenReserve,
  };
}

/** When a launch was created (chain time, seconds): the start of its sealing window. */
export async function launchCreatedAt(id: number): Promise<number | null> {
  const hit = createdAt.get(id);
  if (hit !== undefined) return hit;
  await loadNames([id]);
  const n = names.get(id);
  if (!n) return null;
  const b = await publicClient.getBlock({ blockNumber: n.block });
  createdAt.set(id, Number(b.timestamp));
  return Number(b.timestamp);
}

export async function fetchLaunch(id: number): Promise<Launch | null> {
  const count = Number(await publicClient.readContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "launchCount" }));
  if (!Number.isInteger(id) || id < 0 || id >= count) return null;
  await loadNames([id]);
  const [raw, phase] = (await publicClient.readContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "getLaunch", args: [BigInt(id)] })) as [
    RawLaunch,
    number,
  ];
  return toLaunch(id, raw, phase);
}

export async function fetchLaunches(): Promise<Launch[]> {
  const count = Number(await publicClient.readContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "launchCount" }));
  const ids = Array.from({ length: count }, (_, i) => count - 1 - i);
  await loadNames(ids);
  const rows = await Promise.all(
    ids.map(
      (id) =>
        publicClient.readContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "getLaunch", args: [BigInt(id)] }) as Promise<[RawLaunch, number]>,
    ),
  );
  return rows.map(([raw, phase], i) => toLaunch(ids[i]!, raw, phase));
}

export async function fetchBid(id: number, bidder: Address): Promise<Bid> {
  return (await publicClient.readContract({ address: RELAY_ADDRESS, abi: relayAbi, functionName: "bidOf", args: [BigInt(id), bidder] })) as Bid;
}

export type Activity =
  | { kind: "sealed"; who: Address; eth: bigint; block: bigint; tx: `0x${string}` }
  | { kind: "revealed"; who: Address; eth: bigint; cover: bigint; block: bigint; tx: `0x${string}` }
  | { kind: "swap"; who: Address; buy: boolean; eth: bigint; tokens: bigint; ethReserve: bigint; tokenReserve: bigint; block: bigint; tx: `0x${string}` };

/** Everything that happened in one launch, oldest first. */
export async function fetchActivity(id: number): Promise<Activity[]> {
  const base = { address: RELAY_ADDRESS, abi: relayAbi, fromBlock: FROM_BLOCK, toBlock: "latest" as const, args: { id: BigInt(id) } };
  const [sealed, revealed, swaps] = await Promise.all([
    publicClient.getContractEvents({ ...base, eventName: "Sealed" }),
    publicClient.getContractEvents({ ...base, eventName: "Revealed" }),
    publicClient.getContractEvents({ ...base, eventName: "Swap" }),
  ]);
  const out: Activity[] = [
    ...sealed.map((e) => ({ kind: "sealed" as const, who: e.args.bidder!, eth: e.args.deposit!, block: e.blockNumber, tx: e.transactionHash })),
    ...revealed.map((e) => ({ kind: "revealed" as const, who: e.args.bidder!, eth: e.args.amount!, cover: e.args.cover!, block: e.blockNumber, tx: e.transactionHash })),
    ...swaps.map((e) => ({
      kind: "swap" as const,
      who: e.args.trader!,
      buy: e.args.buy!,
      eth: e.args.ethAmount!,
      tokens: e.args.tokenAmount!,
      ethReserve: e.args.ethReserve!,
      tokenReserve: e.args.tokenReserve!,
      block: e.blockNumber,
      tx: e.transactionHash,
    })),
  ];
  return out.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
}

export type Wire = Activity & { launchId: number; symbol: string };

/**
 * The latest events across every launch, newest first, for the telegraph
 * tape. Looks back a bounded number of blocks: public RPCs cap log ranges,
 * so a wide query is retried narrower before giving up.
 */
export async function fetchWire(limit = 24): Promise<Wire[]> {
  const latest = await publicClient.getBlockNumber();
  for (const span of [400_000n, 50_000n, 5_000n]) {
    const from = latest > span ? latest - span : 0n;
    const fromBlock = from > FROM_BLOCK ? from : FROM_BLOCK;
    try {
      const base = { address: RELAY_ADDRESS, abi: relayAbi, fromBlock, toBlock: "latest" as const };
      const [sealed, revealed, swaps] = await Promise.all([
        publicClient.getContractEvents({ ...base, eventName: "Sealed" }),
        publicClient.getContractEvents({ ...base, eventName: "Revealed" }),
        publicClient.getContractEvents({ ...base, eventName: "Swap" }),
      ]);
      const ids = [...new Set([...sealed, ...revealed, ...swaps].map((e) => Number(e.args.id)))];
      await loadNames(ids);
      const sym = (id: bigint | undefined) => names.get(Number(id))?.symbol ?? "?";
      const rows: (Wire & { li: number })[] = [
        ...sealed.map((e) => ({ kind: "sealed" as const, who: e.args.bidder!, eth: e.args.deposit!, block: e.blockNumber, tx: e.transactionHash, launchId: Number(e.args.id), symbol: sym(e.args.id), li: e.logIndex })),
        ...revealed.map((e) => ({ kind: "revealed" as const, who: e.args.bidder!, eth: e.args.amount!, cover: e.args.cover!, block: e.blockNumber, tx: e.transactionHash, launchId: Number(e.args.id), symbol: sym(e.args.id), li: e.logIndex })),
        ...swaps.map((e) => ({
          kind: "swap" as const,
          who: e.args.trader!,
          buy: e.args.buy!,
          eth: e.args.ethAmount!,
          tokens: e.args.tokenAmount!,
          ethReserve: e.args.ethReserve!,
          tokenReserve: e.args.tokenReserve!,
          block: e.blockNumber,
          tx: e.transactionHash,
          launchId: Number(e.args.id),
          symbol: sym(e.args.id),
          li: e.logIndex,
        })),
      ];
      return rows.sort((a, b) => (a.block === b.block ? b.li - a.li : a.block < b.block ? 1 : -1)).slice(0, limit);
    } catch {
      // range too wide for this RPC: try narrower
    }
  }
  return [];
}

/** ETH per whole token, as a float for display. */
export function salePrice(l: Launch): number {
  if (l.raised === 0n) return 0;
  return Number(l.raised) / Number(SALE_SUPPLY);
}

export function poolPrice(l: Launch): number {
  if (l.tokenReserve === 0n) return 0;
  return Number(l.ethReserve) / Number(l.tokenReserve);
}
