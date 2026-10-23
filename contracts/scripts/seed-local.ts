import { readFileSync } from "node:fs";
import { ethers, network } from "hardhat";

/**
 * Local chain only: fills the launchpad with launches in every phase so the
 * site has something real to show. Uses Hardhat's public test accounts.
 */
const HOUR = 3600;
const E = (n: string) => ethers.parseEther(n);

function meta(description: string, hue: number) {
  // A tiny SVG coin as the image, the way real launches carry a data URI.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="hsl(240 6% ${30 + (hue % 6) * 9}%)"/><circle cx="32" cy="32" r="21" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/></svg>`;
  return JSON.stringify({ description, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, x: "", telegram: "", website: "" });
}

async function main() {
  if (network.name !== "localhost") throw new Error("seed-local only runs against the local node");
  const { address } = JSON.parse(readFileSync("deployments/localhost.json", "utf8"));
  const pad = await ethers.getContractAt("SigilLaunchpad", address);
  const signers = await ethers.getSigners();
  const fee = await pad.launchFee();
  const salt = (n: number) => ethers.zeroPadValue(ethers.toBeHex(n), 32);

  const create = async (who: number, name: string, symbol: string, desc: string, hue: number, seal: number, reveal: number, minRaise: string) => {
    await (await pad.connect(signers[who]).createLaunch(name, symbol, meta(desc, hue), seal, reveal, E(minRaise), { value: fee })).wait();
    return Number(await pad.launchCount()) - 1;
  };
  const sealBid = async (id: number, who: number, amount: string, deposit: string) => {
    const s = salt(1000 + id * 100 + who);
    const c = await pad.commitmentOf(id, signers[who].address, E(amount), s);
    await (await pad.connect(signers[who]).seal(id, c, { value: E(deposit) })).wait();
    return () => pad.connect(signers[who]).reveal(id, E(amount), s).then((t) => t.wait());
  };
  const warp = async (s: number) => {
    await network.provider.send("evm_increaseTime", [s]);
    await network.provider.send("evm_mine", []);
  };

  // Two launches that will be live, one that will fail: run them through every phase first.
  const live1 = await create(2, "Moss Protocol", "MOSS", "Slow-growing, hard to kill. A community coin that sealed its whole launch.", 262, HOUR, HOUR, "1");
  const live2 = await create(3, "Night Heron", "HERON", "Waits in the dark, strikes once. Sealed launch, fair price, no snipers.", 280, HOUR, HOUR, "2");
  const fail = await create(4, "Damp Squib", "SQUIB", "Needed 50 ETH to light. It did not light.", 300, HOUR, HOUR, "50");
  const r: (() => Promise<unknown>)[] = [];
  r.push(await sealBid(live1, 5, "3", "5"), await sealBid(live1, 6, "1.2", "1.2"), await sealBid(live1, 7, "0.8", "2"));
  r.push(await sealBid(live2, 5, "6", "6.5"), await sealBid(live2, 8, "2", "4"), await sealBid(live2, 9, "1", "1"));
  r.push(await sealBid(fail, 6, "1", "1"));
  const unrevealed = await sealBid(live2, 10, "0.5", "0.5"); // never revealed: forfeits 10%
  void unrevealed;
  await warp(HOUR + 5);
  for (const reveal of r) await reveal();
  await warp(HOUR + 5);
  for (const id of [live1, live2, fail]) await (await pad.settle(id)).wait();
  for (const [id, who] of [[live1, 5], [live1, 6], [live2, 5], [live2, 8]] as const) await (await pad.connect(signers[who]).claim(id)).wait();
  // Some trading on the live pools.
  for (const [id, who, eth] of [[live1, 11, "0.4"], [live1, 12, "0.9"], [live2, 11, "1.5"], [live2, 13, "0.3"]] as const) {
    await (await pad.connect(signers[who]).buy(id, 0, { value: E(eth) })).wait();
  }

  // One in its reveal window, two still sealing.
  const revealing = await create(2, "Glass Eel", "GEEL", "See-through on purpose. Reveal window open now.", 250, HOUR, 6 * HOUR, "1");
  const rv = [await sealBid(revealing, 5, "2", "3"), await sealBid(revealing, 6, "1.5", "1.5"), await sealBid(revealing, 7, "0.7", "1.4")];
  await warp(HOUR + 5);
  await rv[0]!();

  const sealing1 = await create(3, "Fern Signal", "FERN", "Unfurls when the seal breaks. Bids are sealed for the next day.", 270, 24 * HOUR, 6 * HOUR, "1");
  await sealBid(sealing1, 8, "1", "2.5");
  await sealBid(sealing1, 9, "0.4", "0.4");
  await sealBid(sealing1, 12, "3", "3.1");
  await create(4, "Quiet Leaf", "LEAF", "Brand new. Be the first sealed bid.", 315, 3 * 24 * HOUR, 12 * HOUR, "0.5");

  console.log(`seeded ${await pad.launchCount()} launches on ${address}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
