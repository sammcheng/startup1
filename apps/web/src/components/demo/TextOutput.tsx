"use client";

export default function TextOutput({ value }: { value: string | null }) {
  if (!value) {
    return <EmptyState message="No text output yet." />;
  }

  return (
    <div className="space-y-3">
      <span className="text-sm font-medium text-stone-200">Rendered output</span>
      <div className="rounded-2xl border border-stone-800 bg-black/30 p-4 text-sm leading-7 text-stone-100 whitespace-pre-wrap">
        {value}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4 text-sm text-stone-500">{message}</p>;
}
