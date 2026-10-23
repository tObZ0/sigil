import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/logo";

export const alt = "Sigil: sealed-bid token launches on Robinhood Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#ffffff", color: "#0b0b0f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40, fontWeight: 600 }}>
          <LogoMark variant="sigil" size={64} />
          Sigil
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 600, letterSpacing: -2, lineHeight: 1.08 }}>
          <span>Bids go in sealed.</span>
          <span style={{ color: "#a1a1aa" }}>Price comes out fair.</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, color: "#52525b", borderTop: "2px solid #ececf0", paddingTop: 28 }}>
          <span>Sealed-bid token launches on Robinhood Chain</span>
          <span style={{ color: "#7c3aed" }}>One price for every bidder</span>
        </div>
      </div>
    ),
    size,
  );
}
