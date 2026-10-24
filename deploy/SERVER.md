# Switching on ZEC bids and Tor

The website stays on Vercel. A small free server runs the part Vercel can't:
the Zcash scanner, the worker that places and reveals ZEC bids, and the onion
service. Both share one free Postgres database on Neon.

```
visitors ──> Vercel site ──┐
                           ├──> Neon Postgres <──┐
Tor users ──> onion ───────┘                     │
              (server: scanner + worker + tor) ──┘──> Zcash, Robinhood Chain
```

Vercel never sees the viewing key or any wallet key. The server keeps 50
payment addresses ready in the database, and the Vercel site hands them out.

You'll need about an hour. Keep `.env.server` (in the Sigil folder on your PC)
open: you fill in its blanks as you go.

## 1. Database (Neon, free)

1. Sign in at neon.tech and create a project called `sigil`.
2. On the dashboard click **Connect**, tick **Connection pooling**, and copy
   the connection string (it contains `-pooler`).
3. Paste it after `DATABASE_URL=` in `.env.server`.

## 2. Zcash wallet (new, only for Sigil)

1. Make a **new** wallet in an app that can export a *unified full viewing
   key* (it starts with `uview1`). YWallet and Zingo both can; look in the
   wallet's backup or export menu.
2. Write the seed phrase down and keep it offline. It never goes on the server.
3. Paste the viewing key after `RELAY_UFVK=`.
4. After `SCAN_BIRTHDAY=`, put the wallet's birthday height (shown in the
   wallet), or today's Zcash block height from a block explorer.

## 3. Hot wallet (new, on Robinhood Chain)

1. Make a **new** EVM wallet, not your fee wallet.
2. Send it the ETH that will fund ZEC bids, e.g. 0.2–0.5 ETH. Every ZEC bid is
   paid from here first, so this caps how big ZEC bids can be.
3. Paste its private key after `HOT_WALLET_KEY=`.

## 4. Server (Oracle Cloud Always Free)

1. Sign up at oracle.com/cloud/free. It asks for a card to check you're real;
   Always Free resources aren't charged.
2. **Create a VM instance**:
   - Image: **Ubuntu 24.04**
   - Shape: **Ampere VM.Standard.A1.Flex**, 2 OCPUs and 12 GB memory
     (inside the free allowance)
   - SSH keys: **Save private key** and keep the downloaded file
   - Leave networking as it is. No ports need opening.
   - "Out of capacity"? Try another availability domain, or again later.
3. Copy the instance's **public IP address** and connect from PowerShell:

   ```
   ssh -i C:\path\to\ssh-key.key ubuntu@<public-ip>
   ```

## 5. Install and start Sigil on the server

Paste these into the server, one block at a time.

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
```

Give the server read-only access to the private repo:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/sigil_deploy -N ""
cat ~/.ssh/sigil_deploy.pub
```

Copy the line it prints and add it at
github.com/tObZ0/sigil/settings/keys/new (title `oracle`, leave
"Allow write access" unticked). Then:

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/sigil_deploy -o StrictHostKeyChecking=accept-new" git clone git@github.com:tObZ0/sigil.git
cd sigil && git config core.sshCommand "ssh -i ~/.ssh/sigil_deploy"
nano .env.server
```

In nano, paste the whole of your filled-in `.env.server`, then Ctrl+O, Enter,
Ctrl+X. Then:

```bash
chmod 600 .env.server
chmod +x deploy/server-up.sh && ./deploy/server-up.sh
```

The first build takes 15–30 minutes (the Rust scanner is the slow part).

## 6. Check it's running

```bash
docker compose -f deploy/compose.server.yml --env-file .env.server logs -f
```

Look for:

- `relay worker: zcash live (mainnet), 3 confirmations`
- `entrypoint: onion at sigillwsps…onion`

Ctrl+C stops following the logs; Sigil keeps running, and restarts by itself
after a reboot.

## 7. Turn ZEC on in the website

Tell Claude the server is up. The remaining Vercel switch:

- You: in Vercel → project `sigil` → Settings → Environment Variables, add
  `DATABASE_URL` (Production) with the same Neon string.
- Claude: sets `NEXT_PUBLIC_ZEC=on` and the onion address, and redeploys.

## Updating later

On the server, from the `sigil` folder: `./deploy/server-up.sh`. It pulls the
latest code and rebuilds.
