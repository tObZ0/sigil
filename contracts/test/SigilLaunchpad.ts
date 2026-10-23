import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { SigilLaunchpad } from "../typechain-types";

const E = (n: string) => ethers.parseEther(n);
const HOUR = 3600;
const SALE = E("500000000");
const TOTAL = E("1000000000");
const DEAD = "0x000000000000000000000000000000000000dEaD";

enum Phase {
  Sealing,
  Revealing,
  Settling,
  Live,
  Failed,
}

async function deploy() {
  const [owner, fees, creator, alice, bob, carol, dave] = await ethers.getSigners();
  const pad = (await (await ethers.getContractFactory("SigilLaunchpad")).deploy(fees.address, E("0.0005"))) as unknown as SigilLaunchpad;
  await pad
    .connect(creator)
    .createLaunch("Sealed Cat", "SCAT", '{"description":"meow"}', HOUR, HOUR, E("1"), { value: E("0.0005") });
  const token = await ethers.getContractAt("SigilToken", (await pad.getLaunch(0)).launch.token);
  return { pad, token, owner, fees, creator, alice, bob, carol, dave };
}

function salt(n: number) {
  return ethers.zeroPadValue(ethers.toBeHex(n), 32);
}

async function sealBid(pad: SigilLaunchpad, who: any, amount: bigint, deposit: bigint, s = salt(7)) {
  const c = await pad.commitmentOf(0, who.address, amount, s);
  await pad.connect(who).seal(0, c, { value: deposit });
  return s;
}

describe("SigilLaunchpad", () => {
  it("creates a launch: 1B tokens held by the launchpad, fee owed to the platform", async () => {
    const { pad, token, fees } = await loadFixture(deploy);
    expect(await token.totalSupply()).to.equal(TOTAL);
    expect(await token.balanceOf(await pad.getAddress())).to.equal(TOTAL);
    expect(await pad.owed(fees.address)).to.equal(E("0.0005"));
    expect(await pad.phaseOf(0)).to.equal(Phase.Sealing);
  });

  it("rejects bad launch params and a wrong launch fee", async () => {
    const { pad, creator } = await loadFixture(deploy);
    await expect(pad.connect(creator).createLaunch("", "X", "", HOUR, HOUR, E("1"), { value: E("0.0005") })).to.be.revertedWithCustomError(pad, "BadParams");
    await expect(pad.connect(creator).createLaunch("A", "B", "", 60, HOUR, E("1"), { value: E("0.0005") })).to.be.revertedWithCustomError(pad, "BadParams");
    await expect(pad.connect(creator).createLaunch("A", "B", "", HOUR, HOUR, E("1"), { value: 0 })).to.be.revertedWithCustomError(pad, "BadParams");
  });

  it("full sealed launch: cover refunded, one price, pool opens at the sale price", async () => {
    const { pad, token, alice, bob, creator, fees } = await loadFixture(deploy);
    // Alice bids 3 ETH hidden inside a 5 ETH deposit; Bob bids 1 ETH with no cover.
    const sa = await sealBid(pad, alice, E("3"), E("5"));
    const sb = await sealBid(pad, bob, E("1"), E("1"), salt(9));
    await expect(pad.connect(alice).reveal(0, E("3"), sa)).to.be.revertedWithCustomError(pad, "WrongPhase");

    await time.increase(HOUR);
    await expect(pad.connect(alice).reveal(0, E("3"), sa)).to.changeEtherBalance(alice, E("2"));
    await pad.connect(bob).reveal(0, E("1"), sb);

    await time.increase(HOUR);
    await pad.settle(0);
    expect(await pad.phaseOf(0)).to.equal(Phase.Live);

    const { launch } = await pad.getLaunch(0);
    expect(launch.raised).to.equal(E("4"));
    // Pool ETH = raise minus 1.5% fees; pool tokens set so price == sale price.
    expect(launch.ethReserve).to.equal(E("3.94"));
    const salePrice = (E("4") * E("1")) / SALE;
    const poolPrice = (launch.ethReserve * E("1")) / launch.tokenReserve;
    expect(poolPrice).to.be.closeTo(salePrice, 1n);
    expect(await token.balanceOf(DEAD)).to.equal(TOTAL - SALE - launch.tokenReserve);

    expect(await pad.owed(creator.address)).to.equal(E("0.02"));
    expect(await pad.owed(fees.address)).to.equal(E("0.0005") + E("0.04"));

    await pad.connect(alice).claim(0);
    await pad.connect(bob).claim(0);
    expect(await token.balanceOf(alice.address)).to.equal((SALE * 3n) / 4n);
    expect(await token.balanceOf(bob.address)).to.equal(SALE / 4n);
    await expect(pad.connect(bob).claim(0)).to.be.revertedWithCustomError(pad, "AlreadyDone");
  });

  it("a reveal must match the seal: wrong amount, wrong salt, or someone else's commitment all fail", async () => {
    const { pad, alice, bob } = await loadFixture(deploy);
    const sa = await sealBid(pad, alice, E("2"), E("2"));
    // Bob copies Alice's commitment: the hash binds Alice's address, so it can't open for Bob.
    await pad.connect(bob).seal(0, await pad.commitmentOf(0, alice.address, E("2"), sa), { value: E("2") });
    await time.increase(HOUR);
    await expect(pad.connect(alice).reveal(0, E("1"), sa)).to.be.revertedWithCustomError(pad, "BadReveal");
    await expect(pad.connect(alice).reveal(0, E("2"), salt(1))).to.be.revertedWithCustomError(pad, "BadReveal");
    await expect(pad.connect(bob).reveal(0, E("2"), sa)).to.be.revertedWithCustomError(pad, "BadReveal");
    await pad.connect(alice).reveal(0, E("2"), sa);
    await expect(pad.connect(alice).reveal(0, E("2"), sa)).to.be.revertedWithCustomError(pad, "AlreadyDone");
  });

  it("a bid can't claim more than its deposit, and one seal per wallet", async () => {
    const { pad, alice } = await loadFixture(deploy);
    const s = await sealBid(pad, alice, E("10"), E("1"));
    await expect(sealBid(pad, alice, E("1"), E("1"))).to.be.revertedWithCustomError(pad, "AlreadySealed");
    await time.increase(HOUR);
    await expect(pad.connect(alice).reveal(0, E("10"), s)).to.be.revertedWithCustomError(pad, "BadReveal");
  });

  it("unrevealed bids lose 10% to the pool and the contract stays solvent", async () => {
    const { pad, token, alice, bob, carol } = await loadFixture(deploy);
    const sa = await sealBid(pad, alice, E("2"), E("2"));
    await sealBid(pad, bob, E("1"), E("1.333333333333333337"));
    await sealBid(pad, carol, E("1"), E("0.777777777777777777"));
    await time.increase(HOUR);
    await pad.connect(alice).reveal(0, E("2"), sa);
    await time.increase(HOUR);
    await pad.settle(0);

    await expect(pad.connect(bob).claim(0)).to.changeEtherBalance(bob, (E("1.333333333333333337") * 9000n) / 10000n);
    await pad.connect(carol).claim(0);
    await pad.connect(alice).claim(0);
    expect(await token.balanceOf(alice.address)).to.equal(SALE);

    // Everything owed can still be paid out of what the contract holds.
    const { launch } = await pad.getLaunch(0);
    const [, fees, creator] = await ethers.getSigners();
    const held = await ethers.provider.getBalance(await pad.getAddress());
    const liabilities = launch.ethReserve + (await pad.owed(fees.address)) + (await pad.owed(creator.address));
    expect(held).to.be.gte(liabilities);
    expect(held - liabilities).to.be.lte(2n);
  });

  it("missing the minimum raise refunds everyone in full", async () => {
    const { pad, alice, bob } = await loadFixture(deploy);
    const sa = await sealBid(pad, alice, E("0.4"), E("0.6"));
    await sealBid(pad, bob, E("0.3"), E("0.3"));
    await time.increase(HOUR);
    await pad.connect(alice).reveal(0, E("0.4"), sa);
    await time.increase(HOUR);
    await pad.settle(0);
    expect(await pad.phaseOf(0)).to.equal(Phase.Failed);
    await expect(pad.connect(alice).claim(0)).to.changeEtherBalance(alice, E("0.4"));
    await expect(pad.connect(bob).claim(0)).to.changeEtherBalance(bob, E("0.3"));
    await expect(pad.connect(alice).buy(0, 0, { value: E("1") })).to.be.revertedWithCustomError(pad, "WrongPhase");
  });

  it("phases gate every action", async () => {
    const { pad, alice } = await loadFixture(deploy);
    await expect(pad.settle(0)).to.be.revertedWithCustomError(pad, "WrongPhase");
    await expect(pad.connect(alice).claim(0)).to.be.revertedWithCustomError(pad, "WrongPhase");
    await time.increase(HOUR);
    await expect(sealBid(pad, alice, E("1"), E("1"))).to.be.revertedWithCustomError(pad, "WrongPhase");
  });

  describe("locked pool", () => {
    async function live() {
      const f = await deploy();
      const s = await sealBid(f.pad, f.alice, E("4"), E("4"));
      await time.increase(HOUR);
      await f.pad.connect(f.alice).reveal(0, E("4"), s);
      await time.increase(HOUR);
      await f.pad.settle(0);
      await f.pad.connect(f.alice).claim(0);
      return f;
    }

    it("buys and sells against x*y=k with a 1% fee split creator/platform", async () => {
      const { pad, token, bob, creator, fees } = await loadFixture(live);
      const before = await pad.getLaunch(0);
      const k0 = before.launch.ethReserve * before.launch.tokenReserve;
      const [out] = await pad.quoteBuy(0, E("1"));
      await expect(pad.connect(bob).buy(0, out + 1n, { value: E("1") })).to.be.revertedWithCustomError(pad, "Slippage");
      const creatorBefore = await pad.owed(creator.address);
      const feesBefore = await pad.owed(fees.address);
      await pad.connect(bob).buy(0, out, { value: E("1") });
      expect(await token.balanceOf(bob.address)).to.equal(out);
      expect((await pad.owed(creator.address)) - creatorBefore).to.equal(E("0.005"));
      expect((await pad.owed(fees.address)) - feesBefore).to.equal(E("0.005"));
      const mid = await pad.getLaunch(0);
      expect(mid.launch.ethReserve * mid.launch.tokenReserve).to.be.gte(k0);

      await token.connect(bob).approve(await pad.getAddress(), out);
      const [ethOut] = await pad.quoteSell(0, out);
      await expect(pad.connect(bob).sell(0, out, ethOut)).to.changeEtherBalance(bob, ethOut);
      // On x*y=k a round trip undoes its own price impact, so it returns
      // exactly the two 1% fees' worth less (minus rounding), never more.
      expect(ethOut).to.be.lte(E("0.9801"));
      expect(ethOut).to.be.gte(E("0.9801") - 10n);
    });

    it("fees are withdrawn by whoever they're owed to", async () => {
      const { pad, creator } = await loadFixture(live);
      const owed = await pad.owed(creator.address);
      await expect(pad.connect(creator).withdraw()).to.changeEtherBalance(creator, owed);
      await expect(pad.connect(creator).withdraw()).to.be.revertedWithCustomError(pad, "BadParams");
    });
  });

  it("only the owner sets fees, within the cap", async () => {
    const { pad, alice } = await loadFixture(deploy);
    await expect(pad.connect(alice).setLaunchFee(0)).to.be.revertedWithCustomError(pad, "OwnableUnauthorizedAccount");
    await expect(pad.setLaunchFee(E("0.02"))).to.be.revertedWithCustomError(pad, "BadParams");
    await pad.setLaunchFee(0);
    expect(await pad.launchFee()).to.equal(0);
  });
});
