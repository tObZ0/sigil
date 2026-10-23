//! relay-scanner: watches the Zcash chain for payments to Relay's
//! deposit addresses.
//!
//! It speaks newline-delimited JSON. Events go to stdout, logs to stderr, and
//! the parent process can ask for addresses on stdin. It keeps no state of its
//! own: the parent stores the scan height and passes `--from` on start, so
//! a crash costs a short rescan, never a missed payment.
//!
//!   stdout  {"type":"tip","height":N}
//!           {"type":"note","txid":"..","action":I,"height":N,"time":T,"index":D,"zatoshis":Z}
//!           {"type":"progress","height":N}       everything <= N has been scanned
//!           {"type":"reorg","rewind_to":N}       forget payments at >= N
//!           {"type":"address","id":..,"index":D,"address":"u1.."}
//!   stdin   {"cmd":"address","id":..,"index":D}
//!
//! `relay-scanner address <index>` prints one address and exits.

mod keys;
mod rpc {
    tonic::include_proto!("cash.z.wallet.sdk.rpc");
}

use std::{collections::VecDeque, sync::Arc, time::Duration};

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::mpsc,
};
use tonic::transport::{Channel, ClientTlsConfig, Endpoint};

use keys::Keys;
use rpc::{compact_tx_streamer_client::CompactTxStreamerClient, BlockId, BlockRange, ChainSpec, CompactBlock};

/// Blocks per GetBlockRange call. Bounded so progress is saved regularly.
const BATCH: u64 = 1_000;
/// How far back to restart after a broken hash chain. Zcash reorgs deeper
/// than a couple of blocks are rare; ten is cheap insurance.
const REORG_REWIND: u64 = 10;
/// How many recent block hashes to keep for reorg detection.
const RECENT: usize = 100;

type Out = mpsc::UnboundedSender<Value>;

#[tokio::main]
async fn main() -> Result<()> {
    let ufvk = std::env::var("RELAY_UFVK").context("RELAY_UFVK is not set")?;
    let keys = Arc::new(Keys::from_ufvk(&ufvk)?);
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.first().map(String::as_str) == Some("address") {
        let index = args.get(1).context("usage: relay-scanner address <index>")?.parse()?;
        println!("{}", keys.address(index));
        return Ok(());
    }

    let from: u64 = flag(&args, "--from")
        .context("--from <height> is required (the wallet's birthday height on first run)")?
        .parse()?;
    let url = std::env::var("LIGHTWALLETD_URL").unwrap_or_else(|_| default_server(&keys).to_string());
    let poll = Duration::from_secs(
        std::env::var("SCAN_POLL_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(20),
    );

    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(write_events(rx));
    tokio::spawn(serve_commands(keys.clone(), tx.clone()));

    eprintln!("scanner: {} network, from {from}, via {url}", keys.network_name());
    let mut scanner = Scanner { keys, out: tx, next: from, recent: VecDeque::new() };
    let mut backoff = Duration::from_secs(2);

    loop {
        let result = async {
            let mut client = connect(&url).await?;
            loop {
                if scanner.step(&mut client).await? {
                    tokio::time::sleep(poll).await;
                }
                backoff = Duration::from_secs(2);
            }
            #[allow(unreachable_code)]
            Ok::<(), anyhow::Error>(())
        }
        .await;
        if let Err(e) = result {
            eprintln!("scanner: {e:#}; retrying in {}s", backoff.as_secs());
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(Duration::from_secs(60));
        }
    }
}

struct Scanner {
    keys: Arc<Keys>,
    out: Out,
    /// Next height to fetch.
    next: u64,
    /// (height, hash) of the last blocks we scanned, oldest first.
    recent: VecDeque<(u64, Vec<u8>)>,
}

impl Scanner {
    /// Scans one batch. Returns true when caught up with the tip.
    async fn step(&mut self, client: &mut CompactTxStreamerClient<Channel>) -> Result<bool> {
        let tip = client.get_latest_block(ChainSpec {}).await?.into_inner().height;
        self.emit(json!({ "type": "tip", "height": tip }));
        if self.next > tip {
            return Ok(true);
        }

        let end = tip.min(self.next + BATCH - 1);
        let range = BlockRange {
            start: Some(BlockId { height: self.next, hash: vec![] }),
            end: Some(BlockId { height: end, hash: vec![] }),
        };
        let mut blocks = client.get_block_range(range).await?.into_inner();

        while let Some(block) = blocks.message().await? {
            if block.height != self.next {
                bail!("server sent block {} while we expected {}", block.height, self.next);
            }
            if !self.extends_chain(&block) {
                let rewind_to = block.height.saturating_sub(REORG_REWIND);
                eprintln!("scanner: reorg at {}, rewinding to {rewind_to}", block.height);
                self.recent.retain(|(h, _)| *h < rewind_to);
                self.next = rewind_to;
                self.emit(json!({ "type": "reorg", "rewind_to": rewind_to }));
                return Ok(false);
            }
            self.scan(&block);
            self.recent.push_back((block.height, block.hash));
            if self.recent.len() > RECENT {
                self.recent.pop_front();
            }
            self.next = block.height + 1;
            if block.height % 100 == 0 {
                self.emit(json!({ "type": "progress", "height": block.height }));
            }
        }

        self.emit(json!({ "type": "progress", "height": self.next - 1 }));
        Ok(self.next > tip)
    }

    fn extends_chain(&self, block: &CompactBlock) -> bool {
        match self.recent.back() {
            Some((height, hash)) if height + 1 == block.height => *hash == block.prev_hash,
            _ => true,
        }
    }

    fn scan(&self, block: &CompactBlock) {
        for tx in &block.vtx {
            for (action, compact) in tx.actions.iter().enumerate() {
                if let Some(received) = self.keys.decrypt(compact) {
                    // Txids are displayed byte-reversed, like every explorer does.
                    let txid: Vec<u8> = tx.hash.iter().rev().copied().collect();
                    self.emit(json!({
                        "type": "note",
                        "txid": hex::encode(txid),
                        "action": action,
                        "height": block.height,
                        "time": block.time,
                        "index": received.index,
                        "zatoshis": received.zatoshis,
                    }));
                }
            }
        }
    }

    fn emit(&self, event: Value) {
        let _ = self.out.send(event);
    }
}

async fn connect(url: &str) -> Result<CompactTxStreamerClient<Channel>> {
    let mut endpoint = Endpoint::from_shared(url.to_string())?
        .connect_timeout(Duration::from_secs(20))
        .tcp_keepalive(Some(Duration::from_secs(30)));
    if url.starts_with("https://") {
        endpoint = endpoint.tls_config(ClientTlsConfig::new().with_webpki_roots())?;
    }
    let channel = endpoint.connect().await.with_context(|| format!("connecting to {url}"))?;
    Ok(CompactTxStreamerClient::new(channel).max_decoding_message_size(32 * 1024 * 1024))
}

fn default_server(keys: &Keys) -> &'static str {
    match keys.network_name() {
        "main" => "https://zec.rocks:443",
        _ => "https://testnet.zec.rocks:443",
    }
}

/// Single writer, so concurrent events never interleave on a line.
async fn write_events(mut rx: mpsc::UnboundedReceiver<Value>) {
    let mut stdout = tokio::io::stdout();
    while let Some(event) = rx.recv().await {
        let mut line = event.to_string();
        line.push('\n');
        if stdout.write_all(line.as_bytes()).await.is_err() || stdout.flush().await.is_err() {
            std::process::exit(1);
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Command {
    Address { id: Value, index: u64 },
}

/// Answers address requests. When stdin closes the parent is gone, and so are we.
async fn serve_commands(keys: Arc<Keys>, out: Out) {
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let event = match serde_json::from_str::<Command>(&line) {
            Ok(Command::Address { id, index }) => {
                json!({ "type": "address", "id": id, "index": index, "address": keys.address(index) })
            }
            Err(e) => json!({ "type": "error", "message": format!("bad command: {e}") }),
        };
        let _ = out.send(event);
    }
    std::process::exit(0);
}

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1))
}
