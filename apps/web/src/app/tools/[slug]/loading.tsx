export default function ToolPageLoading() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Breadcrumb */}
      <nav className="border-b" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-2">
          <div className="skeleton" style={{ width: 80, height: 14 }} />
          <span style={{ color: "var(--faint)" }}>/</span>
          <div className="skeleton" style={{ width: 120, height: 14 }} />
        </div>
      </nav>

      {/* Hero */}
      <header className="border-b" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="skeleton" style={{ width: 100, height: 24, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: 320, height: 40, marginBottom: 12 }} />
          <div className="skeleton" style={{ width: 480, height: 20, marginBottom: 24 }} />
          <div className="flex items-center gap-2.5">
            <div className="skeleton" style={{ width: 20, height: 14 }} />
            <div className="skeleton rounded-full" style={{ width: 24, height: 24 }} />
            <div className="skeleton" style={{ width: 100, height: 14 }} />
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
          {/* Left column */}
          <div className="min-w-0 space-y-10">
            <section>
              <div className="skeleton" style={{ width: 60, height: 12, marginBottom: 16 }} />
              <div className="space-y-2">
                <div className="skeleton" style={{ width: "100%", height: 14 }} />
                <div className="skeleton" style={{ width: "90%", height: 14 }} />
                <div className="skeleton" style={{ width: "75%", height: 14 }} />
                <div className="skeleton" style={{ width: "85%", height: 14 }} />
              </div>
            </section>

            <section>
              <div className="skeleton" style={{ width: 100, height: 12, marginBottom: 20 }} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="skeleton" style={{ width: "100%", height: 160, borderRadius: 12 }} />
                <div className="skeleton" style={{ width: "100%", height: 160, borderRadius: 12 }} />
              </div>
            </section>
          </div>

          {/* Right column */}
          <aside>
            <div
              className="rounded-xl border p-6 space-y-5"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <div>
                <div className="skeleton" style={{ width: 80, height: 32, marginBottom: 4 }} />
                <div className="skeleton" style={{ width: 70, height: 12 }} />
              </div>
              <div className="space-y-2.5">
                <div className="skeleton" style={{ width: "100%", height: 44, borderRadius: 12 }} />
                <div className="skeleton" style={{ width: "100%", height: 44, borderRadius: 12 }} />
              </div>
              <div className="pt-2 space-y-1">
                <div className="skeleton" style={{ width: 90, height: 12, marginBottom: 8 }} />
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between py-3">
                    <div className="skeleton" style={{ width: 80, height: 14 }} />
                    <div className="skeleton" style={{ width: 50, height: 14 }} />
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
