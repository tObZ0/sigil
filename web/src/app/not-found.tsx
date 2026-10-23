import Link from "next/link";

export default function NotFound() {
  return (
    <section className="nf">
      <span className="kicker">404</span>
      <h1>This page doesn&rsquo;t exist.</h1>
      <p className="lede">The link may be wrong, or the page may have moved.</p>
      <div className="hero-actions">
        <Link href="/" className="btn">
          Back to launches
        </Link>
        <Link href="/how" className="btn ghost">
          How it works
        </Link>
      </div>
    </section>
  );
}
