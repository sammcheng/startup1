"use client";

import { useEffect, useState } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";

import { ApiError, api } from "@/lib/api";
import type {
  InputType,
  OutputType,
  OwnershipType,
  Tool,
  ToolCategory,
  ToolUploadResponse,
} from "@/types/tool";

type WizardStep = 1 | 2 | 3 | 4 | 5;

type InputField = {
  id: string;
  name: string;
  type: "string" | "number" | "file" | "url";
  required: boolean;
};

type EnvVar = {
  id: string;
  key: string;
  value: string;
};

type FormState = {
  name: string;
  tagline: string;
  description: string;
  category: ToolCategory;
  ownership_type: OwnershipType;
  input_type: InputType;
  output_type: OutputType;
  output_description: string;
  deployment_url: string;
  entry_command: string;
  port: number;
  price_per_request: string;
  one_time_price: string;
  monthly_calls: number;
  github_url: string;
  upload_mode: "github" | "zip";
  input_fields: InputField[];
  environment_variables: EnvVar[];
  zip_file: File | null;
};

const steps = [
  { id: 1, title: "Basic Info" },
  { id: 2, title: "Upload Code" },
  { id: 3, title: "Configure" },
  { id: 4, title: "Set Pricing" },
  { id: 5, title: "Review & Submit" },
] as const;

const categoryOptions: ToolCategory[] = [
  "nlp",
  "computer_vision",
  "data_analysis",
  "automation",
  "generation",
  "other",
];

const inputTypeOptions: InputType[] = ["text", "image", "json", "csv", "url", "file"];
const outputTypeOptions: OutputType[] = ["json", "text", "image", "csv", "file"];

const initialState: FormState = {
  name: "",
  tagline: "",
  description: "",
  category: "automation",
  ownership_type: "royalty",
  input_type: "text",
  output_type: "json",
  output_description: "",
  deployment_url: "",
  entry_command: "",
  port: 8080,
  price_per_request: "",
  one_time_price: "",
  monthly_calls: 1000,
  github_url: "",
  upload_mode: "github",
  input_fields: [{ id: crypto.randomUUID(), name: "text", type: "string", required: true }],
  environment_variables: [{ id: crypto.randomUUID(), key: "", value: "" }],
  zip_file: null,
};

export default function NewToolPage() {
  const router = useRouter();
  const { getToken, isLoaded } = useAuth();
  const [step, setStep] = useState<WizardStep>(1);
  const [toolId, setToolId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialState);
  const [sourceTree, setSourceTree] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Draft changes are local until you save this step.");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    if (toolId) {
      window.sessionStorage.setItem("draft-tool-id", toolId);
    }
  }, [toolId]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    window.sessionStorage.setItem("new-tool-form", JSON.stringify(form));
  }, [form, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    window.sessionStorage.setItem("new-tool-source-tree", JSON.stringify(sourceTree));
  }, [sourceTree, hasHydrated]);

  useEffect(() => {
    const draftToolId = window.sessionStorage.getItem("draft-tool-id");
    const storedForm = window.sessionStorage.getItem("new-tool-form");
    const storedSourceTree = window.sessionStorage.getItem("new-tool-source-tree");

    if (draftToolId) {
      setToolId(draftToolId);
    }
    if (storedForm) {
      try {
        setForm((current) => ({
          ...current,
          ...JSON.parse(storedForm),
          zip_file: null,
        }));
      } catch {
        window.sessionStorage.removeItem("new-tool-form");
      }
    }
    if (storedSourceTree) {
      try {
        setSourceTree(JSON.parse(storedSourceTree));
      } catch {
        window.sessionStorage.removeItem("new-tool-source-tree");
      }
    }
    setHasHydrated(true);
  }, []);

  async function withToken() {
    const token = await getToken();
    if (!token) {
      throw new Error("You need to be signed in to save a tool draft.");
    }
    return token;
  }

  async function saveBasicInfo() {
    const token = await withToken();
    const payload = {
      name: form.name,
      tagline: form.tagline,
      description: form.description,
      category: form.category,
      ownership_type: form.ownership_type,
    };

    if (toolId) {
      const updated = await api.put<Tool>(`/tools/${toolId}`, payload, { token });
      return updated;
    }

    const created = await api.post<Tool>(
      "/tools",
      {
        ...payload,
        input_type: null,
        output_type: null,
        price_per_request: null,
      },
      { token }
    );
    setToolId(created.id);
    return created;
  }

  async function saveConfiguration() {
    if (!toolId) {
      throw new Error("Save the basic info first so we have a draft to attach configuration to.");
    }
    const token = await withToken();

    await api.post<Tool>(
      `/tools/${toolId}/configure`,
      {
        input_schema: {
          fields: form.input_fields.map((field) => ({
            name: field.name,
            type: field.type,
            required: field.required,
          })),
        },
        output_schema: {
          type: form.output_type,
          description: form.output_description,
        },
        environment_variables: form.environment_variables
          .filter((env) => env.key.trim() && env.value.trim())
          .map((env) => ({ key: env.key.trim(), value: env.value })),
        entry_command: form.entry_command || null,
        port: form.port,
        deployment_url: form.deployment_url.trim() || null,
      },
      { token }
    );

    await api.put<Tool>(
      `/tools/${toolId}`,
      {
        input_type: form.input_type,
        output_type: form.output_type,
      },
      { token }
    );
  }

  async function savePricing() {
    if (!toolId) {
      throw new Error("Save the basic info first so we have a draft to price.");
    }
    const token = await withToken();
    await api.put<Tool>(
      `/tools/${toolId}`,
      {
        price_per_request:
          form.ownership_type === "royalty" && form.price_per_request
            ? form.price_per_request
            : null,
        one_time_price:
          form.ownership_type === "full_sale" && form.one_time_price
            ? form.one_time_price
            : null,
      },
      { token }
    );
  }

  async function saveStep(currentStep: WizardStep) {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      if (currentStep === 1) {
        await saveBasicInfo();
        setStatusMessage("Draft saved. You can keep moving and come back anytime.");
      }

      if (currentStep === 3) {
        await saveConfiguration();
        setStatusMessage("Configuration saved to your draft and runtime config store.");
      }

      if (currentStep === 4) {
        await savePricing();
        setStatusMessage("Pricing saved. Revenue preview updated.");
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      throw error;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleNext() {
    if (step === 1) {
      await saveStep(1);
    }
    if (step === 3) {
      await saveStep(3);
    }
    if (step === 4) {
      await saveStep(4);
    }
    setStep((previous) => Math.min(5, previous + 1) as WizardStep);
  }

  async function handleSaveDraft() {
    await saveStep(step);
  }

  async function handleUpload() {
    setIsSaving(true);
    setErrorMessage(null);

    try {
      let activeToolId = toolId;
      if (!activeToolId) {
        const draft = await saveBasicInfo();
        activeToolId = draft.id;
        setStatusMessage("Draft created. Uploading source now.");
      }

      const token = await withToken();
      if (!activeToolId) {
        throw new Error("We couldn't find a draft tool to attach the upload to.");
      }

      let response: ToolUploadResponse;

      if (form.upload_mode === "github") {
        response = await api.post<ToolUploadResponse>(
          `/tools/${activeToolId}/upload`,
          { github_url: form.github_url },
          { token }
        );
      } else {
        if (!form.zip_file) {
          throw new Error("Choose a zip file before uploading.");
        }
        const body = new FormData();
        body.append("source_zip", form.zip_file);
        response = await api.postFormData<ToolUploadResponse>(
          `/tools/${activeToolId}/upload`,
          body,
          { token }
        );
      }

      setToolId(response.tool_id);
      setSourceTree(response.source_file_tree ?? []);
      setStatusMessage(
        response.status === "processing"
          ? "Source received. We started the MVP processing pipeline in the background."
          : "Source received. Add runtime configuration when you're ready to start processing."
      );
      setStep(3);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit() {
    try {
      await saveStep(3);
      await saveStep(4);
      const activeToolId = toolId ?? window.sessionStorage.getItem("draft-tool-id");
      if (!activeToolId) {
        throw new Error("This draft has not been created yet.");
      }
      router.push(`/dashboard/tools/${activeToolId}/status`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function earnedValue() {
    const price = Number(form.price_per_request || 0);
    return (price * form.monthly_calls).toFixed(2);
  }

  const progress = (step / steps.length) * 100;

  if (!isLoaded) {
    return <div style={{ padding: 32, color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Loading seller tools...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden", marginBottom: 24 }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
          <p style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 8 }}>Seller Studio</p>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text)", marginBottom: 6 }}>Launch a tool without losing your place</h1>
              <p style={{ fontSize: 13.5, color: "var(--muted)", maxWidth: 560 }}>
                Save each step as a draft, upload code, define runtime inputs, and push the tool into processing when you are ready.
              </p>
            </div>
            <div style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px 14px", minWidth: 160 }}>
              <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 4 }}>Draft ID</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{toolId ?? "Not created yet"}</div>
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 24px" }}>
          <div style={{ height: 4, background: "var(--elevated)", borderRadius: 99, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ height: "100%", background: "var(--blue)", borderRadius: 99, width: `${progress}%`, transition: "width .3s ease" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
            {steps.map((item) => {
              const active = item.id === step;
              const complete = item.id < step;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStep(item.id as WizardStep)}
                  style={{
                    background: active ? "var(--blue)" : complete ? "var(--elevated)" : "var(--elevated)",
                    border: `1px solid ${active ? "var(--blue)" : "var(--border)"}`,
                    borderRadius: "var(--radius-sm)",
                    padding: "10px 12px",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all .15s",
                  }}
                >
                  <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".15em", color: active ? "rgba(255,255,255,.7)" : "var(--faint)", marginBottom: 4 }}>Step {item.id}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: active ? "#fff" : complete ? "var(--text)" : "var(--muted)" }}>{item.title}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 20, alignItems: "start" }}>
        {/* Main form */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 28 }}>
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <SectionHeader eyebrow="Step 1" title="Basic info and ownership" description="This creates the draft shell for the tool listing." />
              <WizLabel label="Tool name">
                <WizInput value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="Summarize PDF contract clauses" />
              </WizLabel>
              <WizLabel label="Tagline">
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--faint)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
                  <span>Keep it punchy and specific.</span>
                  <span>{form.tagline.length}/200</span>
                </div>
                <WizInput value={form.tagline} maxLength={200} onChange={(e) => updateField("tagline", e.target.value)} placeholder="Fast extraction pipeline for legal summaries" />
              </WizLabel>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <WizLabel label="Description">
                  <WizTextArea rows={9} value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder={"# What it does\n\nExplain the problem, expected inputs, and what makes your tool useful."} />
                </WizLabel>
                <div style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 16 }}>
                  <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 10 }}>Preview</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
                    {form.description || "Your markdown preview will show up here as you write."}
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <WizLabel label="Category">
                  <WizSelect value={form.category} onChange={(e) => updateField("category", e.target.value as ToolCategory)}>
                    {categoryOptions.map((option) => (
                      <option key={option} value={option}>{humanize(option)}</option>
                    ))}
                  </WizSelect>
                </WizLabel>
                <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                  <legend style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 10 }}>Ownership type</legend>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <RadioCard checked={form.ownership_type === "royalty"} label="I want royalties" description="Charge per request and keep earning as usage grows." onSelect={() => updateField("ownership_type", "royalty")} />
                    <RadioCard checked={form.ownership_type === "full_sale"} label="I want to sell it outright" description="Set a one-time asking price instead of request-based revenue." onSelect={() => updateField("ownership_type", "full_sale")} />
                  </div>
                </fieldset>
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <SectionHeader eyebrow="Step 2" title="Upload code" description="Pick a source path for the MVP processor. GitHub stores the repo URL, zip uploads go straight to S3." />
              <div style={{ background: "rgba(59,130,246,.08)", border: "1px solid rgba(59,130,246,.2)", borderRadius: "var(--radius-md)", padding: 16 }}>
                <div style={{ fontSize: 13.5, color: "var(--text)", fontWeight: 600, marginBottom: 6 }}>Already hosting the API somewhere else?</div>
                <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                  You can skip code upload and connect a live deployed endpoint in Step 3. Hackmarket will route buyers to that API immediately after health-checking it.
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <ChoiceCard active={form.upload_mode === "github"} title="Connect GitHub" body="Paste the repository URL and we'll clone it during processing." onClick={() => updateField("upload_mode", "github")} />
                <ChoiceCard active={form.upload_mode === "zip"} title="Upload Zip" body="Drop a source archive and we'll save it under your tool source path in S3." onClick={() => updateField("upload_mode", "zip")} />
              </div>

              {form.upload_mode === "github" ? (
                <WizLabel label="GitHub repository URL">
                  <WizInput value={form.github_url} onChange={(e) => updateField("github_url", e.target.value)} placeholder="https://github.com/you/your-tool" />
                </WizLabel>
              ) : (
                <label style={{ display: "block", border: "1.5px dashed var(--border-h)", borderRadius: "var(--radius-md)", padding: 32, textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text)", marginBottom: 6 }}>Drag a zip here or browse</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>We&apos;ll upload `source.zip` to your tool bucket path.</div>
                  <input type="file" accept=".zip,application/zip" style={{ display: "block", width: "100%", fontSize: 13, color: "var(--muted)" }} onChange={(e) => updateField("zip_file", e.target.files?.[0] ?? null)} />
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--faint)", fontFamily: "var(--font-mono)" }}>{form.zip_file?.name ?? "No archive selected yet."}</div>
                </label>
              )}

              <div style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 20 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 4 }}>File tree preview</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>Zip uploads show archive entries right away. GitHub starts with a repo placeholder until processing expands it.</div>
                  </div>
                  <button type="button" onClick={handleUpload} disabled={isSaving} style={{ padding: "8px 18px", borderRadius: "var(--radius-sm)", background: "var(--blue)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", opacity: isSaving ? .6 : 1, whiteSpace: "nowrap" }}>
                    {isSaving ? "Uploading..." : "Upload code"}
                  </button>
                </div>
                <div style={{ maxHeight: 240, overflowY: "auto", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 14, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
                  {sourceTree.length ? sourceTree.map((item) => <div key={item} style={{ padding: "2px 0" }}>{item}</div>) : <div style={{ color: "var(--faint)" }}>No uploaded source preview yet.</div>}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <SectionHeader eyebrow="Step 3" title="Runtime configuration" description="Define inputs, outputs, env vars, and either the launch command or a live deployed endpoint." />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <WizLabel label="Live deployment URL (optional)">
                  <WizInput value={form.deployment_url} onChange={(e) => updateField("deployment_url", e.target.value)} placeholder="https://api.yourtool.com" />
                </WizLabel>
                <div style={{ display: "flex", alignItems: "end", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                  If this is filled in, Hackmarket will health-check the URL and use it as the live API instead of building a container for the uploaded source.
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <WizLabel label="Input type">
                  <WizSelect value={form.input_type} onChange={(e) => updateField("input_type", e.target.value as InputType)}>
                    {inputTypeOptions.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}
                  </WizSelect>
                </WizLabel>
                <WizLabel label="Output type">
                  <WizSelect value={form.output_type} onChange={(e) => updateField("output_type", e.target.value as OutputType)}>
                    {outputTypeOptions.map((option) => <option key={option} value={option}>{humanize(option)}</option>)}
                  </WizSelect>
                </WizLabel>
              </div>

              <div style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 20 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Input fields builder</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>Add exactly what the tool expects from the buyer at runtime.</div>
                  </div>
                  <button type="button" onClick={() => setForm((c) => ({ ...c, input_fields: [...c.input_fields, { id: crypto.randomUUID(), name: "", type: "string", required: false }] }))} style={{ padding: "7px 14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                    Add field
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {form.input_fields.map((field) => (
                    <div key={field.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr auto auto", gap: 8, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12 }}>
                      <WizInput value={field.name} onChange={(e) => setForm((c) => ({ ...c, input_fields: c.input_fields.map((f) => f.id === field.id ? { ...f, name: e.target.value } : f) }))} placeholder="Field name" />
                      <WizSelect value={field.type} onChange={(e) => setForm((c) => ({ ...c, input_fields: c.input_fields.map((f) => f.id === field.id ? { ...f, type: e.target.value as InputField["type"] } : f) }))}>
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="file">File</option>
                        <option value="url">URL</option>
                      </WizSelect>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--card)", fontSize: 13, color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
                        <input type="checkbox" checked={field.required} onChange={(e) => setForm((c) => ({ ...c, input_fields: c.input_fields.map((f) => f.id === field.id ? { ...f, required: e.target.checked } : f) }))} />
                        Required
                      </label>
                      <button type="button" onClick={() => setForm((c) => ({ ...c, input_fields: c.input_fields.filter((f) => f.id !== field.id) }))} style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid rgba(220,38,38,.3)", background: "transparent", color: "var(--red)", fontSize: 13, cursor: "pointer" }}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <WizLabel label="Output description">
                <WizTextArea rows={5} value={form.output_description} onChange={(e) => updateField("output_description", e.target.value)} placeholder="Describe the response contract buyers should expect." />
              </WizLabel>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <WizLabel label="Entry command">
                  <WizInput value={form.entry_command} onChange={(e) => updateField("entry_command", e.target.value)} placeholder={form.deployment_url ? "Optional when using a deployed API URL" : "python app.py or node index.js"} />
                </WizLabel>
                <WizLabel label="Port">
                  <WizInput type="number" value={String(form.port)} onChange={(e) => updateField("port", Number(e.target.value || 8080))} placeholder="8080" />
                </WizLabel>
              </div>

              <div style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 20 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Environment variables</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>Secret values stay masked here but are still saved in the draft config.</div>
                  </div>
                  <button type="button" onClick={() => setForm((c) => ({ ...c, environment_variables: [...c.environment_variables, { id: crypto.randomUUID(), key: "", value: "" }] }))} style={{ padding: "7px 14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                    Add variable
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {form.environment_variables.map((env) => (
                    <div key={env.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 12 }}>
                      <WizInput value={env.key} onChange={(e) => setForm((c) => ({ ...c, environment_variables: c.environment_variables.map((v) => v.id === env.id ? { ...v, key: e.target.value } : v) }))} placeholder="OPENAI_API_KEY" />
                      <WizInput type="password" value={env.value} onChange={(e) => setForm((c) => ({ ...c, environment_variables: c.environment_variables.map((v) => v.id === env.id ? { ...v, value: e.target.value } : v) }))} placeholder="sk-..." />
                      <button type="button" onClick={() => setForm((c) => ({ ...c, environment_variables: c.environment_variables.filter((v) => v.id !== env.id) }))} style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid rgba(220,38,38,.3)", background: "transparent", color: "var(--red)", fontSize: 13, cursor: "pointer" }}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <SectionHeader eyebrow="Step 4" title="Pricing" description="Model earnings for royalties or set a single acquisition price." />
              {form.ownership_type === "royalty" ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <WizLabel label="Price per request">
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 14, pointerEvents: "none" }}>$</span>
                        <WizInput style={{ paddingLeft: 26 }} type="number" min="0" step="0.000001" value={form.price_per_request} onChange={(e) => updateField("price_per_request", e.target.value)} placeholder="0.025000" />
                      </div>
                    </WizLabel>
                    <WizLabel label="Calls per month">
                      <WizInput type="number" min="0" value={String(form.monthly_calls)} onChange={(e) => updateField("monthly_calls", Number(e.target.value || 0))} />
                    </WizLabel>
                  </div>
                  <div style={{ background: "rgba(22,163,74,.06)", border: "1px solid rgba(22,163,74,.2)", borderRadius: "var(--radius-md)", padding: 20 }}>
                    <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--green)", marginBottom: 10 }}>Calculator</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
                      If you get {form.monthly_calls.toLocaleString()} calls/month, you&apos;ll earn ${earnedValue()}
                    </div>
                  </div>
                </>
              ) : (
                <WizLabel label="One-time asking price">
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--faint)", fontFamily: "var(--font-mono)", fontSize: 14, pointerEvents: "none" }}>$</span>
                    <WizInput style={{ paddingLeft: 26 }} type="number" min="0" step="0.01" value={form.one_time_price} onChange={(e) => updateField("one_time_price", e.target.value)} placeholder="2500.00" />
                  </div>
                </WizLabel>
              )}
            </div>
          )}

          {step === 5 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <SectionHeader eyebrow="Step 5" title="Review and submit" description="Double-check the listing, runtime contract, and economics before jumping to status tracking." />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <SummaryCard label="Tool name" value={form.name || "Untitled draft"} />
                <SummaryCard label="Category" value={humanize(form.category)} />
                <SummaryCard label="Tagline" value={form.tagline || "No tagline yet"} />
                <SummaryCard label="Ownership" value={form.ownership_type === "royalty" ? "Royalties" : "Full sale"} />
                <SummaryCard label="Input contract" value={`${humanize(form.input_type)} with ${form.input_fields.length} fields`} />
                <SummaryCard label="Output contract" value={`${humanize(form.output_type)} output`} />
                <SummaryCard label="Deployment mode" value={form.deployment_url ? "Bring your own deployed API" : "Hackmarket-managed container build"} />
                <SummaryCard label="Entry command" value={form.entry_command || "Not configured"} />
                <SummaryCard label="Deployment URL" value={form.deployment_url || "Not provided"} />
                <SummaryCard label="Port" value={String(form.port)} />
                <SummaryCard label="Pricing" value={form.ownership_type === "royalty" ? `$${form.price_per_request || "0"} per request` : `$${form.one_time_price || "0"} one-time asking price`} />
                <SummaryCard label="Uploaded items" value={sourceTree.length ? `${sourceTree.length} files indexed` : "No file tree preview yet"} />
              </div>
              <div style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 16 }}>
                <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 10 }}>Description preview</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--muted)", whiteSpace: "pre-wrap" }}>{form.description}</div>
              </div>
              <button type="button" onClick={handleSubmit} disabled={isSaving} style={{ width: "100%", padding: "14px 24px", borderRadius: "var(--radius-sm)", background: "var(--blue)", color: "#fff", fontSize: 15, fontWeight: 600, border: "none", cursor: "pointer", opacity: isSaving ? .6 : 1 }}>
                {isSaving ? "Submitting..." : "Submit for Review"}
              </button>
            </div>
          )}

          <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button type="button" onClick={() => setStep((c) => Math.max(1, c - 1) as WizardStep)} disabled={step === 1 || isSaving} style={{ padding: "10px 20px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer", opacity: (step === 1 || isSaving) ? .4 : 1 }}>
              Back
            </button>
            {step !== 2 && step !== 5 && (
              <button type="button" onClick={handleNext} disabled={isSaving} style={{ padding: "10px 20px", borderRadius: "var(--radius-sm)", background: "var(--blue)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", opacity: isSaving ? .6 : 1 }}>
                {isSaving ? "Saving..." : "Next step"}
              </button>
            )}
            <button type="button" onClick={handleSaveDraft} disabled={isSaving || step === 2 || step === 5} style={{ padding: "10px 20px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer", opacity: (isSaving || step === 2 || step === 5) ? .4 : 1 }}>
              Save as draft
            </button>
          </div>
        </div>

        {/* Aside */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 20 }}>
            <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 10 }}>Draft status</div>
            <div style={{ fontSize: 14, color: "var(--text)" }}>{statusMessage}</div>
            {errorMessage && (
              <div style={{ marginTop: 14, background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.2)", borderRadius: "var(--radius-sm)", padding: "10px 14px", fontSize: 13, color: "var(--red)" }}>
                {errorMessage}
              </div>
            )}
          </div>

          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 20 }}>
            <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 14 }}>Seller checklist</div>
            <ul style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13.5, lineHeight: 1.6, color: "var(--muted)", listStyle: "none", padding: 0, margin: 0 }}>
              <li>Use a deployed API URL if you already host the tool yourself and want the fastest path to production.</li>
              <li>Otherwise, make sure the entry command boots a service on the declared port.</li>
              <li>Zip uploads now wait for runtime configuration before starting background processing.</li>
              <li>GitHub uploads store the repo URL now and clone it during processing.</li>
              <li>Each major step writes back to the draft so you can leave and return later.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader(props: { eyebrow: string; title: string; description: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--blue)", marginBottom: 6 }}>{props.eyebrow}</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-display)", marginBottom: 6 }}>{props.title}</h2>
      <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>{props.description}</p>
    </div>
  );
}

function WizLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

function WizInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="input"
      style={{ display: "block", width: "100%", ...(props.style ?? {}) }}
    />
  );
}

function WizTextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="input"
      style={{ display: "block", width: "100%", resize: "vertical" }}
    />
  );
}

function WizSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="input"
      style={{ display: "block", width: "100%" }}
    />
  );
}

function RadioCard(props: { checked: boolean; label: string; description: string; onSelect: () => void }) {
  return (
    <button type="button" onClick={props.onSelect} style={{ background: props.checked ? "rgba(37,99,235,.06)" : "var(--elevated)", border: `1px solid ${props.checked ? "var(--blue)" : "var(--border)"}`, borderRadius: "var(--radius-sm)", padding: "12px 14px", textAlign: "left", cursor: "pointer", transition: "all .15s" }}>
      <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text)", marginBottom: 4 }}>{props.label}</div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{props.description}</div>
    </button>
  );
}

function ChoiceCard(props: { active: boolean; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} style={{ background: props.active ? "rgba(37,99,235,.06)" : "var(--elevated)", border: `1px solid ${props.active ? "var(--blue)" : "var(--border)"}`, borderRadius: "var(--radius-sm)", padding: "16px 18px", textAlign: "left", cursor: "pointer", transition: "all .15s" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{props.title}</div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{props.body}</div>
    </button>
  );
}

function SummaryCard(props: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
      <div style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: ".1em", color: "var(--faint)", marginBottom: 6 }}>{props.label}</div>
      <div style={{ fontSize: 13.5, color: "var(--text)" }}>{props.value}</div>
    </div>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went sideways while saving this step.";
}
