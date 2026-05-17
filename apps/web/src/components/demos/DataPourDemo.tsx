"use client";

import { useState } from "react";
import {
  DemoShell,
  Pipeline,
  ResetButton,
  usePipelineRunner,
} from "./DemoShared";
import Icon from "./Icon";

const PHASES = [
  { id: "upload", label: "Upload" },
  { id: "validate", label: "Validate" },
  { id: "results", label: "Results" },
];

const SAMPLE_CSV = `name,email,age,signup_date
Jane Cooper,jane@acme.com,28,2025-03-15
Bob Smith,not-an-email,thirty,2025-04-01
Alice Johnson,alice@co.com,34,2025-05-20
,missing@name.com,25,bad-date
Charlie Brown,charlie@co.com,42,2025-06-10`;

const TYPES = ["String", "Email", "Integer", "Date"];

type ColType = "String" | "Email" | "Integer" | "Date";

function detectType(col: string, value: string): ColType {
  if (/email/i.test(col)) return "Email";
  if (/date|at|time/i.test(col)) return "Date";
  if (!isNaN(Number(value)) && value !== "") return "Integer";
  return "String";
}

function validateCell(
  value: string,
  type: ColType | undefined,
  isRequired: boolean,
): string | null {
  if (!value || value.trim() === "") return isRequired ? "Required" : null;
  if (type === "Email" && !/^[\w._-]+@[\w-]+(\.[\w-]+)+$/.test(value))
    return "Invalid email";
  if (type === "Integer" && !/^-?\d+$/.test(value)) return "Not an integer";
  if (type === "Date" && isNaN(Date.parse(value))) return "Invalid date";
  return null;
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(","));
  return { headers, rows };
}

interface RejectedRow {
  row: string[];
  errors: { col: string; msg: string }[];
}

interface Results {
  clean: string[][];
  rejected: RejectedRow[];
}

export default function DataPourDemo() {
  const [phase, setPhase] = useState<string>("upload");
  const [, setCsvText] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [schema, setSchema] = useState<Record<string, ColType>>({});
  const [vStep, setVStep] = useState<number>(-1);
  const [results, setResults] = useState<Results | null>(null);

  const { run, clear } = usePipelineRunner();

  function loadSample() {
    handleParse(SAMPLE_CSV);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => handleParse(String(reader.result || ""));
    reader.readAsText(f);
    e.target.value = "";
  }

  function handleParse(text: string) {
    setCsvText(text);
    const { headers, rows } = parseCsv(text);
    setHeaders(headers);
    setRows(rows);
    const detected: Record<string, ColType> = {};
    headers.forEach((h, i) => {
      const sample = rows.find((r) => r[i] && r[i].trim() !== "");
      detected[h] = detectType(h, sample ? sample[i] : "");
    });
    setSchema(detected);
  }

  function setType(col: string, t: string) {
    setSchema((s) => ({ ...s, [col]: t as ColType }));
  }

  function validate() {
    setResults(null);
    const STEPS = [
      { label: "Parsing file", ms: 80 },
      { label: "Detecting schema", ms: 120 },
      { label: `Validating ${rows.length} rows`, ms: 95 },
      { label: "Separating clean/rejected", ms: 30 },
      { label: "Ingestion complete", ms: 15 },
    ];
    setPhase("validate");
    run(STEPS, setVStep, () => {
      // Compute clean vs rejected
      const clean: string[][] = [];
      const rejected: RejectedRow[] = [];
      for (const r of rows) {
        const errors: { col: string; msg: string }[] = [];
        headers.forEach((h, ci) => {
          const isRequired = ci === 0; // first column required (name)
          const err = validateCell(r[ci] || "", schema[h], isRequired);
          if (err) errors.push({ col: h, msg: err });
        });
        if (errors.length === 0) clean.push(r);
        else rejected.push({ row: r, errors });
      }
      setResults({ clean, rejected });
      setPhase("results");
    });
  }

  function reset() {
    clear();
    setPhase("upload");
    setCsvText("");
    setHeaders([]);
    setRows([]);
    setSchema({});
    setResults(null);
    setVStep(-1);
  }

  return (
    <div className="kc-demo-scope">
      <DemoShell phases={PHASES} currentPhase={phase} height={600}>
        {phase === "upload" && (
          <div className="vv-phase-body">
            {headers.length === 0 ? (
              <>
                <div
                  className="vv-dropzone"
                  onClick={() =>
                    document.getElementById("dp-file-input")?.click()
                  }
                >
                  <div className="vv-dropzone-icon">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
                  <div className="vv-dropzone-text">
                    <b>Upload a CSV file</b> or click to browse
                  </div>
                  <div className="vv-dropzone-sub">CSV, JSON, TXT</div>
                  <input
                    id="dp-file-input"
                    type="file"
                    accept=".csv,.json,.txt"
                    style={{ display: "none" }}
                    onChange={onFile}
                  />
                </div>
                <button className="vv-sample-btn" onClick={loadSample}>
                  <Icon name="sparkle" size={12} color="var(--primary)" />
                  Or use sample data (orders.csv with intentional errors)
                </button>
              </>
            ) : (
              <>
                <div className="dp-schema">
                  <div className="vv-summary-k" style={{ marginBottom: 6 }}>
                    Detected schema · {rows.length} rows
                  </div>
                  <div className="dp-schema-grid">
                    {headers.map((h) => (
                      <div key={h} className="dp-schema-col">
                        <span className="dp-col-name">{h}</span>
                        <select
                          className="dx-field-select"
                          value={schema[h] || "String"}
                          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                            setType(h, e.target.value)
                          }
                        >
                          {TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="dp-preview">
                  <table className="dx-table">
                    <thead>
                      <tr>
                        {headers.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          {r.map((c, j) => (
                            <td key={j}>
                              {c || (
                                <span style={{ color: "var(--ink-4)" }}>—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="dx-phase-footer">
                  <ResetButton onClick={reset} label="Clear" icon="x" />
                  <button className="btn btn-vermillion" onClick={validate}>
                    Validate &amp; ingest <Icon name="arrow-right" size={13} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {phase === "validate" && (
          <div className="vv-phase-body">
            <Pipeline
              steps={[
                { label: "Parsing file", ms: 80 },
                { label: "Detecting schema", ms: 120 },
                { label: `Validating ${rows.length} rows`, ms: 95 },
                { label: "Separating clean/rejected", ms: 30 },
                { label: "Ingestion complete", ms: 15 },
              ]}
              currentIdx={vStep}
              complete={Boolean(results)}
            />
          </div>
        )}

        {phase === "results" && results && (
          <div className="vv-phase-body">
            <div className="dx-result-card dx-result-good">
              <div style={{ fontSize: 13 }}>
                <b>{results.clean.length}</b> of {rows.length} rows passed
                validation. <b>{results.rejected.length}</b> rejected (
                {results.rejected.reduce((s, r) => s + r.errors.length, 0)} total
                errors).
              </div>
            </div>

            {results.clean.length > 0 && (
              <div>
                <div className="vv-summary-k" style={{ marginBottom: 6 }}>
                  Clean rows · {results.clean.length}
                </div>
                <table className="dx-table">
                  <thead>
                    <tr>
                      {headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.clean.map((r, i) => (
                      <tr key={i} className="good">
                        {r.map((c, j) => (
                          <td key={j}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {results.rejected.length > 0 && (
              <div>
                <div className="vv-summary-k" style={{ marginBottom: 6 }}>
                  Rejected rows · {results.rejected.length}
                </div>
                <table className="dx-table">
                  <thead>
                    <tr>
                      {headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.rejected.map((rj, i) => (
                      <tr key={i} className="bad">
                        {rj.row.map((c, j) => {
                          const err = rj.errors.find(
                            (e) => e.col === headers[j],
                          );
                          return (
                            <td key={j}>
                              {c || (
                                <span style={{ color: "var(--ink-4)" }}>—</span>
                              )}
                              {err && <span className="err-pill">{err.msg}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="dx-phase-footer">
              <ResetButton onClick={reset} label="Try another file" />
            </div>
          </div>
        )}
      </DemoShell>
    </div>
  );
}
