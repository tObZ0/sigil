import postgres from "postgres";
import { cfg } from "./config";

// One pool per process. Next's dev server reloads modules, so the pool lives
// on globalThis instead of being recreated (and leaking) on every edit.
/** bigint columns come back as bigint, never as a lossy number. */
export type Sql = postgres.Sql<{ bigint: bigint }>;
const g = globalThis as unknown as { __relaySql?: Sql };
export function db(): Sql {
  return (g.__relaySql ??= postgres(cfg().databaseUrl, {
    max: 5,
    types: { bigint: postgres.BigInt },
    onnotice: () => {},
  }));
}

// Orders and payments meet at `slot`: the diversifier index of the order's
// Zcash deposit address, and also the index of the order's bidding wallet on
// Robinhood Chain. Slots start at a million so they never collide with the
// low indices a wallet app sharing the same key hands out on its own.
const schema = `
create sequence if not exists zec_slot start 1000000;

create table if not exists zec_orders (
  id              text primary key,
  slot            bigint not null unique,
  deposit_address text not null,
  status          text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  updated_at      timestamptz not null default now(),

  launch_id       int not null,
  symbol          text not null,
  dest_address    text,
  refund_address  text,

  bid_wei         numeric(78) not null,
  zat_requested   bigint not null,
  zec_usd         bigint not null,
  eth_usd         bigint not null,

  zat_settled     bigint,
  priced_late     boolean not null default false,
  final_bid_wei   numeric(78),
  fee_wei         numeric(78),
  cover_wei       numeric(78),
  bidder          text,
  salt            text,

  fund_tx         text,
  seal_tx         text,
  reveal_tx       text,
  settle_tx       text,
  claim_tx        text,
  deliver_tx      text,
  drip_tx         text,
  refund_tx       text,
  sweep_tx        text,
  tokens_out      numeric(78),
  refund_wei      numeric(78),
  note            text
);
create index if not exists zec_orders_status on zec_orders (status);

create table if not exists payments (
  txid       text not null,
  action     int not null,
  height     bigint not null,
  block_time timestamptz not null,
  slot       bigint not null,
  zatoshis   bigint not null,
  primary key (txid, action)
);
create index if not exists payments_slot on payments (slot);

create table if not exists meta (
  key   text primary key,
  value text not null
);
`;

export async function migrate(): Promise<void> {
  await db().unsafe(schema);
}

export async function getMeta(key: string): Promise<string | null> {
  const [row] = await db()<{ value: string }[]>`select value from meta where key = ${key}`;
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string | number | bigint): Promise<void> {
  await db()`
    insert into meta (key, value) values (${key}, ${String(value)})
    on conflict (key) do update set value = excluded.value`;
}

export type OrderStatus =
  | "awaiting" // waiting for the ZEC
  | "confirming" // ZEC seen, not deep enough yet
  | "paid" // ready to bid (or waiting for Sigil's float)
  | "funding" // bidding wallet being funded
  | "funded" // bidding wallet has the ETH
  | "sealed" // bid sealed on-chain
  | "revealed" // bid revealed, cover back
  | "claimed" // tokens (or the returned bid) in the bidding wallet
  | "delivered" // tokens sent to the bidder's address
  | "refunded" // launch was returned; ETH sent to the bidder's address
  | "expired" // nothing arrived in time
  | "attention"; // a person has to look: late payment, missed window, failed tx

export const ACTIVE: OrderStatus[] = ["paid", "funding", "funded", "sealed", "revealed", "claimed"];

export interface ZecOrder {
  id: string;
  slot: bigint;
  deposit_address: string;
  status: OrderStatus;
  created_at: Date;
  expires_at: Date;
  updated_at: Date;
  launch_id: number;
  symbol: string;
  dest_address: string | null;
  refund_address: string | null;
  bid_wei: string;
  zat_requested: bigint;
  zec_usd: bigint;
  eth_usd: bigint;
  zat_settled: bigint | null;
  priced_late: boolean;
  final_bid_wei: string | null;
  fee_wei: string | null;
  cover_wei: string | null;
  bidder: string | null;
  salt: string | null;
  fund_tx: string | null;
  seal_tx: string | null;
  reveal_tx: string | null;
  settle_tx: string | null;
  claim_tx: string | null;
  deliver_tx: string | null;
  drip_tx: string | null;
  refund_tx: string | null;
  sweep_tx: string | null;
  tokens_out: string | null;
  refund_wei: string | null;
  note: string | null;
}
