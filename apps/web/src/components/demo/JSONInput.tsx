"use client";

import { useMemo } from "react";

import type { DemoInputProps } from "./types";

export default function JSONInput({
  label = "JSON input",
  value,
  onChange,
  disabled,
  error,
  placeholder,
}: DemoInputProps<string>) {
  const validationError = useMemo(() => {
    if (!value.trim()) {
      return null;
    }
    try {
      JSON.parse(value);
      return null;
    } catch {
      return "This JSON is not valid yet.";
    }
  }, [value]);

  function handleFormat() {
    try {
      const formatted = JSON.stringify(JSON.parse(value), null, 2);
      onChange(formatted);
    } catch {
      // validation message already covers this state
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-stone-200">{label}</label>
        <button
          type="button"
          onClick={handleFormat}
          disabled={disabled || !value.trim() || !!validationError}
          className="rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-300 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Format
        </button>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder || '{\n  "text": "Hello world"\n}'}
        disabled={disabled}
        rows={10}
        className="w-full rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 font-mono text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {!error && validationError ? <p className="text-sm text-amber-300">{validationError}</p> : null}
      {!error && !validationError && value.trim() ? <p className="text-sm text-emerald-300">Valid JSON ready to send.</p> : null}
      {!value.trim() ? <p className="text-sm text-stone-500">Enter a JSON object or array to test the tool.</p> : null}
    </div>
  );
}
