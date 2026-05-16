export default function DashboardLoading() {
  return (
    <div>
      {/* Header skeleton */}
      <div style={{ marginBottom: 32 }}>
        <div className="skeleton" style={{ width: 140, height: 12, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: 260, height: 28, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 220, height: 14 }} />
      </div>

      {/* Stat cards skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 28 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "20px 18px",
            }}
          >
            <div className="skeleton" style={{ width: 100, height: 11, marginBottom: 18 }} />
            <div className="skeleton" style={{ width: 80, height: 28, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: 70, height: 12 }} />
          </div>
        ))}
      </div>

      {/* Main grid skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr .6fr", gap: 16 }}>
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: 20,
            minHeight: 200,
          }}
        >
          <div className="skeleton" style={{ width: 120, height: 12, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 100, height: 16, marginBottom: 20 }} />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 14, marginBottom: 14 }} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "16px 18px",
              }}
            >
              <div className="skeleton" style={{ width: 130, height: 14, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: 180, height: 12 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
