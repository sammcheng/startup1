export default function MarketplaceLoading() {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header skeleton */}
      <div style={{ marginBottom: 28 }}>
        <div className="skeleton" style={{ width: 180, height: 14, marginBottom: 10 }} />
        <div className="skeleton" style={{ width: 320, height: 28, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 400, height: 14 }} />
      </div>

      {/* Filter bar skeleton */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <div className="skeleton" style={{ width: 200, height: 38, borderRadius: "var(--radius-sm)" }} />
        <div className="skeleton" style={{ width: 120, height: 38, borderRadius: "var(--radius-sm)" }} />
        <div className="skeleton" style={{ width: 120, height: 38, borderRadius: "var(--radius-sm)" }} />
      </div>

      {/* Tool cards grid skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: 20,
            }}
          >
            <div className="skeleton" style={{ width: "60%", height: 16, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 13, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: "80%", height: 13, marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 4 }} />
              <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 4 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
