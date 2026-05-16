"use client";

import type { DemoInputProps } from "./types";

export default function NumberInput({
  label = "Number input",
  value,
  onChange,
  disabled,
  error,
  placeholder,
}: DemoInputProps<string>) {
  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-stone-200">{label}</label>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || "8"}
        disabled={disabled}
        className="w-full rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {!error && value.length === 0 ? (
        <p className="text-sm text-stone-500">Set how many listing images to analyze, or leave blank for the tool default.</p>
      ) : null}
    </div>
  );
}
