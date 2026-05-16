import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 48,
          fontWeight: 700,
          color: "var(--border)",
          marginBottom: 8,
          letterSpacing: "-.03em",
        }}
      >
        404
      </p>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(20px, 3vw, 28px)",
          fontWeight: 700,
          color: "var(--text)",
          marginBottom: 10,
        }}
      >
        Page not found
      </h1>
      <p
        style={{
          fontSize: 14,
          color: "var(--muted)",
          maxWidth: 380,
          marginBottom: 24,
          lineHeight: 1.6,
        }}
      >
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <Link
          href="/"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 600,
            padding: "10px 20px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--blue)",
            color: "#fff",
            textDecoration: "none",
          }}
        >
          Go home
        </Link>
        <Link
          href="/marketplace"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 600,
            padding: "10px 20px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--text)",
            textDecoration: "none",
          }}
        >
          Browse marketplace
        </Link>
      </div>
    </div>
  );
}
