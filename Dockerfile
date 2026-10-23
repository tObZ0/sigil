# One container: tor in front, the Relay site and the ZEC worker behind it,
# relay-scanner as the worker's child. Built for Railway.

FROM rust:1.94-bookworm AS scanner
WORKDIR /build
COPY scanner/ ./
RUN cargo build --release --locked && cp target/release/relay-scanner /relay-scanner

FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# NEXT_PUBLIC_* values are baked into the browser bundle, so they're build args.
ARG NEXT_PUBLIC_RELAY_NETWORK=mainnet
# Defaults: the SigilLaunchpad deployed on Robinhood Chain mainnet (contracts/deployments/robinhoodMainnet.json).
ARG NEXT_PUBLIC_RELAY_ADDRESS=0x8F0BF4cF16B82e5A1C4835bd5A368a6FBe57E183
ARG NEXT_PUBLIC_RELAY_FROM_BLOCK=96307576
ARG NEXT_PUBLIC_ONION_ADDRESS
ENV NEXT_PUBLIC_RELAY_NETWORK=$NEXT_PUBLIC_RELAY_NETWORK \
    NEXT_PUBLIC_RELAY_ADDRESS=$NEXT_PUBLIC_RELAY_ADDRESS \
    NEXT_PUBLIC_RELAY_FROM_BLOCK=$NEXT_PUBLIC_RELAY_FROM_BLOCK \
    NEXT_PUBLIC_ONION_ADDRESS=$NEXT_PUBLIC_ONION_ADDRESS \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm run build:worker && npm prune --omit=dev

FROM node:22-bookworm-slim
# tor from the Tor Project's own repo: Debian's lags, and proof-of-work
# defence against onion floods needs 0.4.8+.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg tini \
 && curl -fsSL https://deb.torproject.org/torproject.org/A3C4F0F979CAA22CDBA8F512EE8CBC9E886DDD89.asc \
    | gpg --dearmor -o /usr/share/keyrings/tor-archive-keyring.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/tor-archive-keyring.gpg] https://deb.torproject.org/torproject.org bookworm main" \
    > /etc/apt/sources.list.d/tor.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends tor \
 && apt-get purge -y curl gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=web /build/package.json ./
COPY --from=web /build/node_modules ./node_modules
COPY --from=web /build/.next ./.next
COPY --from=web /build/dist ./dist
COPY --from=scanner /relay-scanner /usr/local/bin/relay-scanner
COPY deploy/torrc.template /etc/tor/torrc.template
COPY --chmod=755 deploy/entrypoint.sh /entrypoint.sh

ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
