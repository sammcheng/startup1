"use client";

import { useRef } from "react";
import type { DemoFileValue, DemoInputProps } from "./types";

type FileValue = DemoFileValue | null;

interface FileInputExtraProps extends DemoInputProps<FileValue> {
  accept?: string;
}

export default function FileInput({
  label = "File input",
  value,
  onChange,
  disabled,
  error,
  accept,
}: FileInputExtraProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const content = await readFile(file);
    onChange({
      name: file.name,
      content,
      mimeType: file.type || "application/octet-stream",
    });
  }

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-stone-200">{label}</label>
      <div
        className="rounded-[24px] border-2 border-dashed border-stone-700 bg-stone-900/70 p-6 text-center transition hover:border-cyan-300/60"
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (disabled) {
            return;
          }
          const file = event.dataTransfer.files[0];
          if (file) {
            void handleFile(file);
          }
        }}
      >
        {value ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-stone-100">{value.name}</p>
            <p className="text-xs text-stone-400">{value.mimeType || "File ready"}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-3xl text-stone-500">↑</div>
            <p className="text-sm text-stone-300">Drop a file here or click to browse.</p>
            <p className="text-xs text-stone-500">{accept ? `Accepted: ${accept}` : "Any file type is allowed for this demo."}</p>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleFile(file);
          }
        }}
      />
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {!error && !value ? <p className="text-sm text-stone-500">No file selected yet.</p> : null}
    </div>
  );
}

async function readFile(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        if (result.startsWith("data:")) {
          resolve(result.split(",")[1] ?? "");
        } else {
          resolve(btoa(result));
        }
      } else {
        reject(new Error("Could not read the selected file."));
      }
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}
