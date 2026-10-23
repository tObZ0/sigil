# Sigil

Sealed launches on Robinhood Chain. Every launch opens with a sealed window:
buyers lock ETH against a hash of their real bid (plus optional "cover" so the
deposit doesn't give the size away). Then every envelope opens, cover is
refunded, and everyone buys at one price. The raise seeds a pool that's locked
forever and opens at the sale price. No snipers, no bundles, no team allocation.

Bids can also be paid in **shielded ZEC**, with no wallet, and the site is
served as a **Tor onion** too. Sigil seals a ZEC bid from a fresh wallet of its
own, so on-chain nothing leads back to whoever paid.

```
contracts/  Hardhat: SigilLaunchpad.sol, SigilToken.sol, tests, deploy + local seed
web/        Next.js site + the ZEC relayer (src/server, worker)
scanner/    relay-scanner (Rust): finds shielded payments with a viewing key only
deploy/     tor config and the container entrypoint
Dockerfile  tor + site + worker + scanner in one container (Railway)
```

## The rules (enforced by the contract)

| | |
|---|---|
| Supply | 1,000,000,000. 500M sold in the sealed sale; the pool gets what it needs of the rest, the remainder is burned |
| Price | revealed ETH ÷ 500M, the same for every bidder |
| Fees | 1% platform + 0.5% creator on the raise; 1% on swaps, split creator/platform |
| Unrevealed bid | 10% to the pool if the launch goes live; full refund if it fails |
| Minimum raise | set per launch (≥ 0.01 ETH); below it, every bid is refunded |
| Windows | seal 10 min – 7 days, reveal 10 min – 2 days |

## Bidding with shielded ZEC

1. On `/zec` the bidder picks a launch, a bid in ETH and the Robinhood Chain
   address the tokens should go to. They get a one-time shielded address and
   a ZEC amount at a locked rate (median of Kraken, Coinbase and CoinGecko).
2. `relay-scanner` sees the payment with the viewing key; after 3
   confirmations the order is paid. Paying late uses the rate then; paying
   short bids what it covers.
3. The worker derives a fresh bidding wallet for the order (from
   `ORDER_KEY_SEED`), funds it from Sigil's float with the bid, 25–100% cover
   and gas, and seals the bid.
4. When the seal breaks the worker reveals it (a ZEC bidder can't miss the
   reveal), settles the launch if nobody has, and claims.
5. Live launch: tokens plus a little ETH for gas go to the bidder's address.
   Returned launch: the bid comes back to that address as ETH. Leftover cover
   and gas go back to the float.

The pages work with JavaScript off (Tor Browser at "Safest"): plain forms and
an order page that refreshes itself. The order link is the only receipt.

Anything a machine shouldn't decide alone (ZEC arriving after sealing closed,
a missed window, an interrupted transfer) stops at `attention` with a note.
Refunds of ZEC are done by hand from the wallet that holds the seed.

**Custody:** Sigil holds a bidder's money from payment until the launch
settles. That's a custodial privacy service; know where you stand legally
before running it with real money.

## Run it locally

```bash
cd contracts && npm install && npx hardhat test
npx hardhat node --port 8546                       # separate terminal
npx hardhat run scripts/deploy.ts --network localhost
npx hardhat run scripts/seed-local.ts --network localhost   # launches in every phase
cd ../web && npm install && npm run dev            # uses web/.env.local
```

In local mode the wallet menu has a "Dev wallet" (Hardhat's public test
account #15). It only exists when `NEXT_PUBLIC_RELAY_NETWORK=local`.

For ZEC bids (dev mode: fake addresses, no viewing key needed):

```bash
docker compose up -d db                 # Postgres on 127.0.0.1:5434
cd web && npm run worker                # separate terminal
npm run dev:pay -- <order-id>           # pretend the ZEC arrived
npm test                                # quote math + commitment tests
```

## Deploy to Robinhood Chain mainnet

1. `contracts/.env`: `DEPLOYER_PRIVATE_KEY` (a fresh deployer with a little
   ETH), `FEE_RECIPIENT`, optionally `LAUNCH_FEE_ETH` (default 0.0005).
2. `npx hardhat run scripts/deploy.ts --network robinhoodMainnet` writes
   `deployments/robinhoodMainnet.json`.
3. Verify: `npx hardhat verify --network robinhoodMainnet <address> <feeRecipient> <launchFeeWei>`.
4. Site build variables: `NEXT_PUBLIC_RELAY_NETWORK=mainnet`,
   `NEXT_PUBLIC_RELAY_ADDRESS`, `NEXT_PUBLIC_RELAY_FROM_BLOCK` (the deploy block).

## Run the relayer and onion on Railway

1. **Keys, on your own machine:**
   - Onion: `cd web && npm run onion:keygen -- relay` (optional prefix).
   - Zcash: a new wallet just for Sigil. Export its unified full viewing key
     (`uview1…`) and note the block height it was created at. The seed never
     goes near the server.
   - Robinhood Chain: a new hot wallet holding only the float you're willing
     to have online, and 32 random bytes for `ORDER_KEY_SEED` (back it up).
2. **Railway:** new project from this repo (it uses the `Dockerfile`), add
   Postgres. Build variables: the `NEXT_PUBLIC_*` values above plus
   `NEXT_PUBLIC_ONION_ADDRESS`. Runtime variables: `DATABASE_URL`,
   `RELAY_UFVK`, `SCAN_BIRTHDAY`, `HOT_WALLET_KEY`, `ORDER_KEY_SEED`,
   `ONION_SECRET_KEY`. The rest have defaults (see `web/.env.example`).
3. Public networking on serves the normal site too; set `HOSTNAME=127.0.0.1`
   to make it onion-only. The log prints `entrypoint: onion at <address>`.

The contract hasn't been audited. Start with small launches.
