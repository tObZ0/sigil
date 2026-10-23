import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const NETWORKS: Record<string, number> = { robinhoodMainnet: 4663, localhost: 31337 };

/** Dev only: saves a deploy made from /deploy to contracts/deployments/<network>.json, like scripts/deploy.ts does. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const body = (await req.json().catch(() => null)) as { network?: string; address?: string; block?: number; tx?: string } | null;
  const chainId = body?.network ? NETWORKS[body.network] : undefined;
  if (!body || !chainId || !/^0x[0-9a-fA-F]{40}$/.test(body.address ?? "") || !Number.isInteger(body.block) || !/^0x[0-9a-fA-F]{64}$/.test(body.tx ?? "")) {
    return Response.json({ error: "bad deployment" }, { status: 400 });
  }
  const dir = path.resolve(process.cwd(), "../contracts/deployments");
  await mkdir(dir, { recursive: true });
  const out = { network: body.network, chainId, address: body.address, block: body.block, tx: body.tx };
  await writeFile(path.join(dir, `${body.network}.json`), JSON.stringify(out, null, 2) + "\n");
  return Response.json({ saved: `contracts/deployments/${body.network}.json` });
}
