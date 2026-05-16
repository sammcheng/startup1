"use client";

import { useMemo, useState } from "react";

export default function TableOutput({ value }: { value: string | null }) {
  const [sortColumn, setSortColumn] = useState(0);
  const [descending, setDescending] = useState(false);

  const parsed = useMemo(() => {
    if (!value?.trim()) {
      return { headers: [] as string[], rows: [] as string[][] };
    }
    const rows = value
      .trim()
      .split("\n")
      .map((row) => row.split(",").map((cell) => cell.trim()));
    return {
      headers: rows[0] ?? [],
      rows: rows.slice(1),
    };
  }, [value]);

  const sortedRows = useMemo(() => {
    const rows = [...parsed.rows];
    rows.sort((left, right) => {
      const a = left[sortColumn] ?? "";
      const b = right[sortColumn] ?? "";
      return descending ? b.localeCompare(a) : a.localeCompare(b);
    });
    return rows;
  }, [descending, parsed.rows, sortColumn]);

  if (!parsed.headers.length) {
    return <EmptyState message="No table output yet." />;
  }

  return (
    <div className="space-y-3">
      <span className="text-sm font-medium text-stone-200">CSV table</span>
      <div className="overflow-auto rounded-2xl border border-stone-800 bg-black/30">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-900/80 text-stone-300">
            <tr>
              {parsed.headers.map((header, index) => (
                <th key={header} className="px-4 py-3 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      if (sortColumn === index) {
                        setDescending((current) => !current);
                      } else {
                        setSortColumn(index);
                        setDescending(false);
                      }
                    }}
                    className="transition hover:text-cyan-200"
                  >
                    {header}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.join("-")}`} className="border-t border-stone-800 text-stone-100">
                {row.map((cell, cellIndex) => (
                  <td key={`${rowIndex}-${cellIndex}`} className="px-4 py-3">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="rounded-2xl border border-stone-800 bg-stone-900/60 p-4 text-sm text-stone-500">{message}</p>;
}
