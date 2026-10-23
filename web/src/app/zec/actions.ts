"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { openOrder, type OrderForm } from "@/server/orders";

/**
 * The ZEC bid form posts here. It works with JavaScript off: a plain form
 * post, then a redirect. On a mistake, the form values and errors ride back
 * in a short-lived cookie, never in the URL.
 */
export async function createZecOrder(formData: FormData) {
  const f: OrderForm = {
    launchId: String(formData.get("launch") ?? "").slice(0, 12),
    bid: String(formData.get("bid") ?? "").slice(0, 30),
    dest: String(formData.get("dest") ?? "").slice(0, 100),
    refund: String(formData.get("refund") ?? "").slice(0, 700),
  };
  const result = await openOrder(f);
  if (result.ok) redirect(`/zec/o/${result.id}`);
  (await cookies()).set("zec_form", JSON.stringify({ f, errors: result.errors }), {
    maxAge: 120,
    httpOnly: true,
    sameSite: "lax",
    path: "/zec",
  });
  redirect(`/zec?launch=${encodeURIComponent(f.launchId)}`);
}
