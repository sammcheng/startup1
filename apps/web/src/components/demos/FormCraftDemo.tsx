"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { DemoShell, Pipeline, ResetButton, usePipelineRunner } from "./DemoShared";
import Icon from "./Icon";

interface FormField {
  id: string;
  label: string;
  type: "text" | "email" | "dropdown" | "textarea" | "radio";
  required: boolean;
  options?: string[];
  showWhen?: { field: string; equals: string };
}

const PHASES = [
  { id: "build", label: "Build" },
  { id: "compile", label: "Compile" },
  { id: "preview", label: "Preview" },
];

const COMPILE_STEPS = [
  { label: "Compiling field schema", ms: 500 },
  { label: "Resolving conditional logic", ms: 700 },
  { label: "Generating validation rules", ms: 600 },
];

const INITIAL_FIELDS: FormField[] = [
  { id: "name", label: "Full Name", type: "text", required: true },
  { id: "email", label: "Email", type: "email", required: true },
  { id: "inquiry", label: "Inquiry Type", type: "dropdown", required: true, options: ["General", "Support", "Sales"] },
  { id: "message", label: "Message", type: "textarea", required: true },
  { id: "priority", label: "Priority", type: "radio", required: false, options: ["Low", "Medium", "High"], showWhen: { field: "inquiry", equals: "Support" } },
];

const TYPE_ICONS: Record<string, string> = { text: "T", email: "@", dropdown: "▾", textarea: "¶", radio: "○" };

function validateValue(field: FormField, value: any): string | null {
  if (field.required && (!value || (typeof value === "string" && value.trim() === ""))) {
    return `${field.label} is required`;
  }
  if (field.type === "email" && value && !/^[\w._-]+@[\w-]+(\.[\w-]+)+$/.test(value)) {
    return "Enter a valid email";
  }
  return null;
}

export default function FormCraftDemo() {
  const [phase, setPhase] = useState<string>("build");
  const [fields, setFields] = useState<FormField[]>(INITIAL_FIELDS);
  const [compileStep, setCompileStep] = useState<number>(-1);
  const [ready, setReady] = useState<boolean>(false);

  const [values, setValues] = useState<Record<string, any>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState<boolean>(false);

  const { run, clear } = usePipelineRunner();

  function toggleRequired(id: string) {
    setFields((arr) => arr.map((f) => f.id === id ? { ...f, required: !f.required } : f));
  }
  function removeField(id: string) { setFields((arr) => arr.filter((f) => f.id !== id)); }

  function compile() {
    setReady(false); setValues({}); setTouched({}); setSubmitted(false);
    setPhase("compile");
    run(COMPILE_STEPS, setCompileStep, () => { setReady(true); setPhase("preview"); });
  }

  function reset() {
    clear(); setPhase("build"); setCompileStep(-1); setReady(false);
    setValues({}); setTouched({}); setSubmitted(false);
  }

  // Compute visible fields based on conditional logic
  const visibleFields = useMemo(() => fields.filter((f) => {
    if (!f.showWhen) return true;
    return values[f.showWhen.field] === f.showWhen.equals;
  }), [fields, values]);

  const errors = useMemo(() => {
    const errs: Record<string, string> = {};
    for (const f of visibleFields) {
      const err = validateValue(f, values[f.id]);
      if (err) errs[f.id] = err;
    }
    return errs;
  }, [visibleFields, values]);

  const allValid = Object.keys(errors).length === 0;

  function setValue(id: string, v: any) {
    setValues((cur) => ({ ...cur, [id]: v }));
    setTouched((cur) => ({ ...cur, [id]: true }));
  }

  function submit() {
    setTouched(Object.fromEntries(visibleFields.map((f) => [f.id, true])));
    if (allValid) setSubmitted(true);
  }

  return (
    <div className="kc-demo-scope">
      <DemoShell phases={PHASES} currentPhase={phase} height={620}>
        {phase === "build" && (
          <div className="vv-phase-body">
            <div className="fc-fields">
              {fields.map((f) => (
                <div key={f.id} className="fc-field-row">
                  <span className="fc-field-icon">{TYPE_ICONS[f.type] || "·"}</span>
                  <span className="fc-field-name">{f.label}</span>
                  <span className="fc-field-type">{f.type}</span>
                  <button
                    className={`fc-required ${f.required ? "on" : ""}`}
                    onClick={() => toggleRequired(f.id)}
                    title="Toggle required"
                  >
                    {f.required ? "required" : "optional"}
                  </button>
                  {f.showWhen && (
                    <span className="fc-cond" title={`Shows when ${f.showWhen.field} = ${f.showWhen.equals}`}>
                      if {f.showWhen.field}={f.showWhen.equals}
                    </span>
                  )}
                  <button className="fc-remove" onClick={() => removeField(f.id)} title="Remove">
                    <Icon name="x" size={11} stroke={2.6} />
                  </button>
                </div>
              ))}
            </div>
            <div className="dx-phase-footer">
              <span className="dx-helper">{fields.length} fields · conditional logic enabled</span>
              <button className="btn btn-vermillion" onClick={compile} disabled={fields.length === 0}>
                Preview form <Icon name="arrow-right" size={13} />
              </button>
            </div>
          </div>
        )}

        {phase === "compile" && (
          <div className="vv-phase-body">
            <Pipeline steps={COMPILE_STEPS} currentIdx={compileStep} complete={ready} />
          </div>
        )}

        {phase === "preview" && (
          <div className="vv-phase-body">
            <div className="fc-grid">
              <form className="fc-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <AnimatePresence initial={false}>
                  {visibleFields.map((f) => {
                    const err = touched[f.id] && errors[f.id];
                    return (
                      <motion.div key={f.id} layout
                        initial={{ opacity: 0, y: -4, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -4, height: 0 }}
                        transition={{ duration: 0.22 }}
                        style={{ overflow: "hidden" }}
                      >
                        <div className="dx-field">
                          <span className="dx-field-label">{f.label}{f.required && <span style={{ color: "var(--primary)" }}> *</span>}</span>
                          {f.type === "textarea" && (
                            <textarea className={`dx-field-textarea ${err ? "invalid" : ""}`} rows={2} value={values[f.id] || ""}
                              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setValue(f.id, e.target.value)} onBlur={() => setTouched({ ...touched, [f.id]: true })} />
                          )}
                          {f.type === "dropdown" && (
                            <select className={`dx-field-select ${err ? "invalid" : ""}`} value={values[f.id] || ""}
                              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setValue(f.id, e.target.value)} onBlur={() => setTouched({ ...touched, [f.id]: true })}>
                              <option value="">Select…</option>
                              {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          )}
                          {f.type === "radio" && (
                            <div className="fc-radio-row">
                              {f.options?.map((o) => (
                                <label key={o} className={`fc-radio ${values[f.id] === o ? "on" : ""}`}>
                                  <input type="radio" name={f.id} checked={values[f.id] === o} onChange={() => setValue(f.id, o)} />
                                  {o}
                                </label>
                              ))}
                            </div>
                          )}
                          {(f.type === "text" || f.type === "email") && (
                            <input className={`dx-field-input ${err ? "invalid" : ""}`} type={f.type} value={values[f.id] || ""}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(f.id, e.target.value)} onBlur={() => setTouched({ ...touched, [f.id]: true })} />
                          )}
                          {err && <span className="fc-err">{err}</span>}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                <button type="submit" className="btn btn-vermillion" style={{ marginTop: 6 }} disabled={submitted}>
                  {submitted ? "Submitted ✓" : "Submit"}
                </button>
              </form>

              <div className="fc-output">
                <div className="vv-summary-k" style={{ marginBottom: 6 }}>Submission data</div>
                <pre className="dx-code">{JSON.stringify(visibleFields.reduce((acc: Record<string, any>, f) => ({ ...acc, [f.id]: values[f.id] || null }), {}), null, 2)}</pre>
              </div>
            </div>

            <div className="dx-phase-footer">
              <ResetButton onClick={reset} label="Edit fields" />
            </div>
          </div>
        )}
      </DemoShell>
    </div>
  );
}
