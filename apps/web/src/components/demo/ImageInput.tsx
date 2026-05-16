"use client";

import { useRef, useState } from "react";

import type { DemoImageValue, DemoInputProps } from "./types";

type ImageValue = DemoImageValue | null;

export default function ImageInput({
  label = "Image input",
  value,
  onChange,
  disabled,
  error,
}: DemoInputProps<ImageValue>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setLocalError("Images must be 10MB or smaller.");
      return;
    }

    const dataUrl = await readAsDataUrl(file);
    setLocalError(null);
    onChange({
      base64: dataUrl.split(",")[1] ?? "",
      previewUrl: dataUrl,
      filename: file.name,
      mimeType: file.type || "image/jpeg",
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
        {value?.previewUrl ? (
          <div className="space-y-3">
            <img src={value.previewUrl} alt="Preview" className="mx-auto max-h-64 rounded-2xl object-contain" />
            <p className="text-sm text-stone-300">{value.filename}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-3xl text-stone-500">↑</div>
            <p className="text-sm text-stone-300">Drop an image here or click to browse.</p>
            <p className="text-xs text-stone-500">PNG, JPG, WEBP, or GIF</p>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleFile(file);
          }
        }}
      />
      {error || localError ? <p className="text-sm text-red-300">{error ?? localError}</p> : null}
      {!error && !localError && !value ? <p className="text-sm text-stone-500">No image selected yet.</p> : null}
    </div>
  );
}

async function readAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}
