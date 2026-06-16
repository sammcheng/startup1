"use client";

import { useRef, useState } from "react";

import type { DemoImageValue, DemoInputProps } from "./types";

type ImageArrayValue = DemoImageValue[];

export default function ImageArrayInput({
  label = "Images",
  value,
  onChange,
  disabled,
  error,
}: DemoInputProps<ImageArrayValue>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleFiles(files: FileList | File[]) {
    const selectedFiles = Array.from(files);

    if (selectedFiles.length > 5) {
      setLocalError("Upload up to 5 images at a time.");
      return;
    }

    const oversizedFile = selectedFiles.find((file) => file.size > 10 * 1024 * 1024);
    if (oversizedFile) {
      setLocalError(`"${oversizedFile.name}" is larger than the 10MB upload limit.`);
      return;
    }

    const nextImages = await Promise.all(selectedFiles.map(readImageFile));
    setLocalError(null);
    onChange(nextImages);
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
          if (disabled || !event.dataTransfer.files.length) {
            return;
          }
          void handleFiles(event.dataTransfer.files);
        }}
      >
        {value.length ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {value.map((image) => (
	                <div key={image.filename} className="rounded-2xl border border-stone-800 bg-stone-950/80 p-3">
	                  <div
	                    aria-label={image.filename}
	                    className="h-32 w-full rounded-xl bg-cover bg-center"
	                    role="img"
	                    style={{ backgroundImage: `url(${image.previewUrl})` }}
	                  />
	                  <p className="mt-2 truncate text-xs text-stone-300">{image.filename}</p>
	                </div>
              ))}
            </div>
            <p className="text-sm text-stone-400">{value.length} image{value.length === 1 ? "" : "s"} ready for analysis.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-3xl text-stone-500">↑</div>
            <p className="text-sm text-stone-300">Drop one or more listing photos here or click to browse.</p>
            <p className="text-xs text-stone-500">PNG, JPG, WEBP, or GIF</p>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          if (event.target.files?.length) {
            void handleFiles(event.target.files);
          }
        }}
      />
      {error || localError ? <p className="text-sm text-red-300">{error ?? localError}</p> : null}
      {!error && !localError && !value.length ? <p className="text-sm text-stone-500">No images selected yet.</p> : null}
    </div>
  );
}

async function readImageFile(file: File): Promise<DemoImageValue> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });

  return {
    base64: dataUrl.split(",")[1] ?? "",
    previewUrl: dataUrl,
    filename: file.name,
    mimeType: file.type || "image/jpeg",
  };
}
