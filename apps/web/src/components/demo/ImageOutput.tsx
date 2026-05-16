"use client";

export default function ImageOutput({ value }: { value: string | null }) {
  if (!value) {
    return <EmptyState message="No image output yet." />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-stone-200">Image result</span>
        <a
          href={value}
          download
          className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-300 transition hover:border-cyan-300"
        >
          Download
        </a>
      </div>
      <div className="rounded-2xl border border-stone-800 bg-black/30 p-4">
        <img src={value} alt="Tool output" className="max-h-[420px] w-full rounded-2xl object-contain" />
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4 text-sm text-stone-500">{message}</p>;
}
