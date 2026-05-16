"use client";

export default function FileOutput({ value }: { value: string | null }) {
  if (!value) {
    return <EmptyState message="No downloadable file yet." />;
  }

  return (
    <div className="space-y-3">
      <span className="text-sm font-medium text-stone-200">Download result</span>
      <div className="rounded-2xl border border-stone-800 bg-black/30 p-4">
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-full border border-cyan-300/30 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-300"
        >
          Download file
        </a>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4 text-sm text-stone-500">{message}</p>;
}
