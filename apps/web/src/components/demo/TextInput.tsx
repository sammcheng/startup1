"use client";

import type { DemoInputProps } from "./types";

export default function TextInput({
  label = "Text input",
  value,
  onChange,
  disabled,
  error,
  placeholder,
}: DemoInputProps<string>) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-stone-200">{label}</label>
        <span className="text-xs text-stone-500">{value.length} chars</span>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || "Enter your input"}
        disabled={disabled}
        rows={7}
        className="w-full rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : value.length === 0 ? (
        <p className="text-sm text-stone-500">Paste a prompt, query, or content sample to run the tool.</p>
      ) : null}
    </div>
  );
}
