import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Deployer } from "./deployer";

export const metadata: Metadata = { title: "Deploy", robots: { index: false } };

/**
 * One-time contract deploy, signed in your own wallet so the deployer key
 * never touches a file. Only exists under `next dev`; production builds 404.
 */
export default function DeployPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Deployer />;
}
