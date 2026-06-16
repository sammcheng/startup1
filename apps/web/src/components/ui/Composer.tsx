"use client";

import { useEffect, useRef, useState } from "react";
import { NLP_CATEGORIES, segmentsToText, tokenize } from "@/lib/nlpSearch";
import type { Segment } from "@/lib/nlpSearch";

interface Props {
  initialSegments?: Segment[];
  onSubmit: (segs: Segment[]) => void;
  /** Fires on every keystroke (debounced upstream if needed). Receives raw text. */
  onChange?: (text: string) => void;
}

export default function Composer({ initialSegments, onSubmit, onChange }: Props) {
  const [text, setText] = useState(() => segmentsToText(initialSegments ?? []));
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (initialSegments) {
      setText(segmentsToText(initialSegments));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [initialSegments]);

  // Fire onChange whenever text changes (parent debounces).
  useEffect(() => {
    onChangeRef.current?.(text);
  }, [text]);

  function addCategory(cat: string) {
    setText((prev) => {
      const trimmed = prev.replace(/\s+$/, "");
      const re = new RegExp(`\\b${cat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(trimmed)) return prev;
      const sep = trimmed.length === 0 ? "" : (/[.,;]$/.test(trimmed) ? " " : ", ");
      return trimmed + sep + cat + " ";
    });
    inputRef.current?.focus();
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(tokenize(trimmed));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const hasContent = text.trim().length > 0;
  const presentCats = new Set(
    NLP_CATEGORIES.map((c) => c.id).filter((id) =>
      new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)
    )
  );

  return (
    <div>
      <div className="v3-composer-wrap focused" onClick={() => inputRef.current?.focus()}>
        <div className="v3-composer-inline">
          <input
            ref={inputRef}
            className="v3-composer-input"
            value={text}
            placeholder="I'm looking for a tool that…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
          />
        </div>
        <button className="v3-composer-submit" disabled={!hasContent} onClick={submit}>
          Find tools{" "}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <div className="v3-chip-row">
        <span className="v3-chip-label">Add a category</span>
        {NLP_CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={`v3-chip${presentCats.has(c.id) ? " active" : ""}`}
            onClick={() => addCategory(c.id)}
            disabled={presentCats.has(c.id)}
          >
            <span className="plus">+</span> {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
