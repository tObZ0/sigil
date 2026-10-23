import { mkdirSync, writeFileSync } from "node:fs";
import { ethers, network } from "hardhat";

/**
 * Deploys SigilLaunchpad and writes deployments/<network>.json for the site.
 *   FEE_RECIPIENT  where platform fees go (required off the local chain)
 *   LAUNCH_FEE_ETH launch fee in ETH (default 0.0005, contract cap 0.01)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const local = network.name === "localhost" || network.name === "hardhat";
  const feeRecipient = process.env.FEE_RECIPIENT ?? (local ? deployer.address : "");
  if (!ethers.isAddress(feeRecipient)) throw new Error("Set FEE_RECIPIENT to a valid address");
  const launchFee = ethers.parseEther(process.env.LAUNCH_FEE_ETH ?? "0.0005");

  console.log(`network   ${network.name}`);
  console.log(`deployer  ${deployer.address} (${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH)`);
  console.log(`fees to   ${feeRecipient}`);
  console.log(`launch fee ${ethers.formatEther(launchFee)} ETH`);

  const pad = await (await ethers.getContractFactory("SigilLaunchpad")).deploy(feeRecipient, launchFee);
  const receipt = await pad.deploymentTransaction()!.wait();
  const address = await pad.getAddress();
  console.log(`SigilLaunchpad ${address} (block ${receipt!.blockNumber})`);

  mkdirSync("deployments", { recursive: true });
  const out = { network: network.name, chainId: Number((await ethers.provider.getNetwork()).chainId), address, block: receipt!.blockNumber };
  writeFileSync(`deployments/${network.name}.json`, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
