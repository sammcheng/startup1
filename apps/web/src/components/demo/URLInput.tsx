"use client";

import type { DemoInputProps } from "./types";

export default function URLInput({
  label = "URL input",
  value,
  onChange,
  disabled,
  error,
  placeholder,
}: DemoInputProps<string>) {
  const validationError = value && !isValidUrl(value) ? "Enter a full URL starting with http:// or https://." : null;

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-stone-200">{label}</label>
      <input
        type="url"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || "https://example.com"}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        className="w-full rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {!error && validationError ? <p className="text-sm text-amber-300">{validationError}</p> : null}
      {!error && !validationError && !value ? <p className="text-sm text-stone-500">Paste a public URL for the demo request.</p> : null}
    </div>
  );
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
