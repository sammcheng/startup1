import Link from "next/link";

export default function ToolNotFound() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: "var(--bg)" }}
    >
      <p
        className="text-6xl font-bold mb-4"
        style={{ fontFamily: "var(--font-mono)", color: "var(--border)" }}
      >
        404
      </p>
      <h1
        className="text-xl font-semibold mb-2"
        style={{ color: "var(--text)" }}
      >
        Tool not found
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--muted)", maxWidth: 400 }}>
        This tool may have been removed, renamed, or is no longer available on the marketplace.
      </p>
      <div className="flex gap-3">
        <Link
          href="/marketplace"
          className="rounded-xl px-5 py-2.5 text-sm font-semibold transition-all hover:opacity-90"
          style={{ background: "var(--blue)", color: "#fff" }}
        >
          Browse Marketplace
        </Link>
        <Link
          href="/"
          className="rounded-xl px-5 py-2.5 text-sm font-medium border transition-all hover:border-[var(--border-h)]"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
