"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FileInput from "./FileInput";
import DynamicForm from "./DynamicForm";
import ImageInput from "./ImageInput";
import JSONInput from "./JSONInput";
import JSONOutput from "./JSONOutput";
import TextInput from "./TextInput";
import URLInput from "./URLInput";
import FileOutput from "./FileOutput";
import ImageOutput from "./ImageOutput";
import TableOutput from "./TableOutput";
import TextOutput from "./TextOutput";
import type { DemoFileValue, DemoImageValue, DemoInputSchema, DemoRunnerProps, DemoSchemaField, DemoResult } from "./types";
import { API_BASE, getGatewayBaseUrl } from "@/lib/api";
import { DEMO_API_KEY } from "@/lib/env";

const GATEWAY_BASE = getGatewayBaseUrl();
const DEMO_BASE = API_BASE;
const SESSION_LIMIT = 10;
const STORAGE_KEY = "hackmarket-demo-calls";

type FileValue = DemoFileValue | null;
type ImageValue = DemoImageValue | null;
type DynamicDemoValue = Record<string, string | number | boolean | DemoFileValue | DemoImageValue[] | null>;

export default function DemoRunner({
  toolSlug,
  inputType,
  inputSchema,
  outputType,
  demoEndpoint: demoEndpointProp,
  autoRun,
}: DemoRunnerProps) {
  const schema = (inputSchema ?? {}) as DemoInputSchema;
  const [textValue, setTextValue] = useState(defaultStringValue(schema));
  const [jsonValue, setJsonValue] = useState(defaultJsonValue(schema));
  const [urlValue, setUrlValue] = useState("");
  const [fileValue, setFileValue] = useState<FileValue>(null);
  const [imageValue, setImageValue] = useState<ImageValue>(null);
  const [dynamicValue, setDynamicValue] = useState<Record<string, unknown>>({});
  const autoRanRef = useRef(false);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [callsUsed, setCallsUsed] = useState(readSessionCount());

  const dynamicFields = useMemo(
    () => (Array.isArray(schema.fields) ? schema.fields : []),
    [schema.fields],
  );
  const sessionRemaining = Math.max(SESSION_LIMIT - callsUsed, 0);
  const sessionLimited = sessionRemaining <= 0;
  const supportsListingUrlAndImages = hasListingUrlAndImageInputs(dynamicFields);
  const listingBlocked = supportsListingUrlAndImages && isListingSiteBlockedMessage(error ?? "");

  const validationError = useMemo(() => {
    if (dynamicFields.length) {
      return validateDynamicFields(dynamicFields, dynamicValue);
    }
    if (inputType === "json" && jsonValue.trim()) {
      try {
        JSON.parse(jsonValue);
      } catch {
        return "Fix the JSON before running the demo.";
      }
    }
    if (inputType === "url" && urlValue && !isValidUrl(urlValue)) {
      return "Enter a valid URL before running the demo.";
    }
    if (inputType === "image" && !imageValue) {
      return "Select an image before running the demo.";
    }
    if ((inputType === "file" || inputType === "csv") && !fileValue) {
      return "Upload a file before running the demo.";
    }
    if (inputType === "text" && !textValue.trim()) {
      return "Enter some text before running the demo.";
    }
    return null;
  }, [dynamicFields, dynamicValue, fileValue, imageValue, inputType, jsonValue, textValue, urlValue]);

  const runDemo = useCallback(async (useDynamic: Record<string, unknown>) => {
    if (sessionLimited) {
      setError("You’ve used the 10 free demo calls for this session. Sign up to keep testing tools.");
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);

    const startedAt = performance.now();
    try {
      const payload = buildPayload({
        inputType,
        textValue,
        jsonValue,
        urlValue,
        fileValue,
        imageValue,
        dynamicValue: useDynamic,
        dynamicFields,
      });

      const demoEndpoint = demoEndpointProp
        ?? (DEMO_API_KEY
          ? `${GATEWAY_BASE}/tools/${toolSlug}`
          : `${DEMO_BASE}/tools/${toolSlug}/demo`);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (DEMO_API_KEY) {
        headers["X-API-Key"] = DEMO_API_KEY;
      }

      const response = await fetch(demoEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const requestId = response.headers.get("X-HackMarket-Request-Id");
      const responseTimeMs = Math.max(Math.round(performance.now() - startedAt), 1);
      const data = await parseResponse(response);

      if (!response.ok) {
        setError(extractErrorMessage(data, response.status));
        setResult({
          data,
          status: response.status,
          responseTimeMs,
          requestId,
        });
      } else {
        incrementSessionCount();
        setCallsUsed(readSessionCount());
        setResult({
          data,
          status: response.status,
          responseTimeMs,
          requestId,
        });
      }
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The demo request failed.");
    } finally {
      setIsRunning(false);
    }
  }, [
    demoEndpointProp,
    dynamicFields,
    fileValue,
    imageValue,
    inputType,
    jsonValue,
    sessionLimited,
    textValue,
    toolSlug,
    urlValue,
  ]);

  const handleRun = useCallback(
    (overrideDynamic?: Record<string, unknown>) => runDemo(overrideDynamic ?? dynamicValue),
    [dynamicValue, runDemo],
  );

  // Auto-run: pre-fill fields using QA-generated inputs if available, else smartDefault.
  useEffect(() => {
    if (!autoRun || autoRanRef.current || dynamicFields.length === 0) return;
    const fills: Record<string, unknown> = {};
    for (const field of dynamicFields) {
      const val = schema.qa_inputs?.[field.name] ?? smartDefault(field);
      if (val !== null) fills[field.name] = val;
    }
    if (Object.keys(fills).length === 0) return;
    autoRanRef.current = true;
    setDynamicValue(fills);
    const timer = setTimeout(() => void runDemo(fills), 700);
    return () => clearTimeout(timer);
  }, [autoRun, dynamicFields, runDemo, schema.qa_inputs]);

  return (
    <section className="rounded-[32px] border border-stone-800 bg-stone-950/80 p-6 shadow-2xl shadow-black/20">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-cyan-300/70">API Playground</div>
          <h2 className="mt-2 text-2xl font-semibold text-stone-100">Try the live tool through the gateway</h2>
          <p className="mt-2 text-sm leading-6 text-stone-400">
            Demo runs are rate limited and count against a 10-call session limit in this browser.
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
          {sessionRemaining} free calls left this session
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
        <div className="rounded-[28px] border border-stone-800 bg-black/20 p-5">
          <div className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-400">Input</div>
          {supportsListingUrlAndImages ? (
            <div className="mb-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
              This tool accepts either a property listing URL or uploaded photos. Some listing sites block automated
              scraping in production, so photo upload is the most reliable path when a URL request is rejected.
            </div>
          ) : null}
          {renderInput({
            inputType,
            schema,
            textValue,
            setTextValue,
            jsonValue,
            setJsonValue,
            urlValue,
            setUrlValue,
            fileValue,
            setFileValue,
            imageValue,
            setImageValue,
            dynamicValue,
            setDynamicValue,
            disabled: isRunning || sessionLimited,
            validationError,
          })}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={isRunning || sessionLimited}
              className="rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-stone-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? "Running..." : "Run"}
            </button>
            {result ? (
              <span className="text-sm text-stone-400">
                Completed in {result.responseTimeMs}ms
                {result.requestId ? ` · Request ${result.requestId}` : ""}
              </span>
            ) : null}
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100">
              <div>{error}</div>
              {listingBlocked ? (
                <div className="mt-3 space-y-2 text-red-100/85">
                  <div>
                    Zillow, Redfin, Realtor, and many MLS pages block automated scraping from cloud servers. The
                    listing URL path is best-effort only.
                  </div>
                  <div className="rounded-2xl border border-red-300/20 bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-red-200/70">Fastest recovery</div>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm">
                      <li>Open the listing in your browser.</li>
                      <li>Save 2-5 property photos or screenshots.</li>
                      <li>Upload them in the <span className="font-semibold">Images</span> field and run again.</li>
                    </ol>
                  </div>
                  <div className="text-xs text-red-100/70">
                    If you want, we can also keep hardening the scraper path — but photo upload is the reliable route
                    today.
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {!error && !result ? (
            <div className="mt-4 rounded-2xl border border-stone-800 bg-stone-900/60 p-4 text-sm text-stone-500">
              Configure the input and run the tool to see live output here.
            </div>
          ) : null}
        </div>

        <div className="rounded-[28px] border border-stone-800 bg-black/20 p-5">
          <div className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-400">Output</div>
          {listingBlocked ? (
            <div className="mb-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
              The tool is reachable, but the listing site rejected the scrape request. Uploading images directly is
              the working path for this tool right now.
            </div>
          ) : null}
          {renderOutput(outputType, result?.data ?? null)}
        </div>
      </div>
    </section>
  );
}

function renderInput(props: {
  inputType: DemoRunnerProps["inputType"];
  schema: DemoInputSchema;
  textValue: string;
  setTextValue: (value: string) => void;
  jsonValue: string;
  setJsonValue: (value: string) => void;
  urlValue: string;
  setUrlValue: (value: string) => void;
  fileValue: FileValue;
  setFileValue: (value: FileValue) => void;
  imageValue: ImageValue;
  setImageValue: (value: ImageValue) => void;
  dynamicValue: Record<string, unknown>;
  setDynamicValue: (value: Record<string, unknown>) => void;
  disabled: boolean;
  validationError: string | null;
}) {
  if (props.schema.fields?.length) {
    return (
      <DynamicForm
        schema={props.schema}
        value={props.dynamicValue as DynamicDemoValue}
        onChange={props.setDynamicValue as (value: DynamicDemoValue) => void}
        disabled={props.disabled}
      />
    );
  }

  if (props.inputType === "json") {
    return (
      <JSONInput
        value={props.jsonValue}
        onChange={props.setJsonValue}
        disabled={props.disabled}
        error={props.validationError?.includes("JSON") ? props.validationError : null}
        placeholder={props.schema.placeholder}
      />
    );
  }
  if (props.inputType === "image") {
    return (
      <ImageInput
        value={props.imageValue}
        onChange={props.setImageValue}
        disabled={props.disabled}
        error={props.validationError?.includes("image") ? props.validationError : null}
      />
    );
  }
  if (props.inputType === "url") {
    return (
      <URLInput
        value={props.urlValue}
        onChange={props.setUrlValue}
        disabled={props.disabled}
        error={props.validationError?.includes("URL") ? props.validationError : null}
        placeholder={props.schema.placeholder}
      />
    );
  }
  if (props.inputType === "file" || props.inputType === "csv") {
    return (
      <FileInput
        label={props.inputType === "csv" ? "CSV file" : "File"}
        value={props.fileValue}
        onChange={props.setFileValue}
        disabled={props.disabled}
        error={props.validationError?.includes("file") ? props.validationError : null}
        accept={props.inputType === "csv" ? ".csv,text/csv" : undefined}
      />
    );
  }
  return (
    <TextInput
      value={props.textValue}
      onChange={props.setTextValue}
      disabled={props.disabled}
      error={props.validationError?.includes("text") ? props.validationError : null}
      placeholder={props.schema.placeholder}
    />
  );
}

function renderOutput(outputType: DemoRunnerProps["outputType"], data: unknown) {
  if (outputType === "text") {
    return <TextOutput value={typeof data === "string" ? data : data ? JSON.stringify(data, null, 2) : null} />;
  }
  if (outputType === "image") {
    return <ImageOutput value={extractImageValue(data)} />;
  }
  if (outputType === "csv") {
    return <TableOutput value={typeof data === "string" ? data : null} />;
  }
  if (outputType === "file") {
    return <FileOutput value={extractFileValue(data)} />;
  }
  return <JSONOutput value={data} />;
}

function buildPayload(args: {
  inputType: DemoRunnerProps["inputType"];
  textValue: string;
  jsonValue: string;
  urlValue: string;
  fileValue: FileValue;
  imageValue: ImageValue;
  dynamicValue: Record<string, unknown>;
  dynamicFields: DemoSchemaField[];
}) {
  if (args.dynamicFields.length) {
    const payload: Record<string, unknown> = {};
    for (const field of args.dynamicFields) {
      const normalized = normalizeFieldValue(field, args.dynamicValue[field.name]);
      if (normalized !== undefined && normalized !== null && normalized !== "") {
        payload[field.name] = normalized;
      }
    }
    return payload;
  }
  if (args.inputType === "json") {
    return JSON.parse(args.jsonValue);
  }
  if (args.inputType === "image") {
    return { input: args.imageValue?.base64 ?? "" };
  }
  if (args.inputType === "file" || args.inputType === "csv") {
    return {
      input: args.fileValue?.content ?? "",
      filename: args.fileValue?.name ?? "",
      mime_type: args.fileValue?.mimeType ?? "",
    };
  }
  if (args.inputType === "url") {
    return { input: args.urlValue };
  }
  return { input: args.textValue };
}

function normalizeFieldValue(field: DemoSchemaField, value: unknown) {
  if (field.type === "number") {
    const raw = typeof value === "string" ? value.trim() : value;
    if (raw === "" || raw === null || raw === undefined) {
      return undefined;
    }
    return Number(raw);
  }
  if (field.type === "file") {
    if (field.name === "images") {
      const images = Array.isArray(value) ? (value as DemoImageValue[]) : [];
      if (!images.length) {
        return undefined;
      }

      return images.map((image) => ({
        filename: image.filename,
        base64: image.base64,
        mimetype: image.mimeType || "image/jpeg",
      }));
    }

    const file = value as FileValue;
    if (!file) {
      return undefined;
    }

    return {
      filename: file.name,
      base64: file.content,
      mimetype: file.mimeType,
    };
  }
  return value;
}

function validateDynamicFields(fields: DemoSchemaField[], value: Record<string, unknown>) {
  const imageField = fields.find((field) => field.name === "images" && field.type === "file");
  const urlField = fields.find((field) => field.name === "url" && field.type === "url");
  if (imageField && urlField) {
    const hasImage = Array.isArray(value.images) ? value.images.length > 0 : Boolean(value.images);
    const hasUrl = Boolean(String(value.url ?? "").trim());
    if (!hasImage && !hasUrl) {
      return "Provide either a property URL or an image before running the demo.";
    }
  }

  for (const field of fields) {
    const fieldValue = value[field.name];
    if (field.required) {
      if (field.type === "file" && !fieldValue) {
        return `${humanize(field.name)} is required.`;
      }
      if (field.type !== "file" && !String(fieldValue ?? "").trim()) {
        return `${humanize(field.name)} is required.`;
      }
    }
    if (field.type === "url" && fieldValue && !isValidUrl(String(fieldValue))) {
      return `${humanize(field.name)} must be a valid URL.`;
    }
    if (field.type === "url" && field.name === "url" && fieldValue && !isLikelyPropertyListingUrl(String(fieldValue))) {
      return "Use a Zillow, Redfin, Realtor, or MLS listing URL for this demo.";
    }
    if (field.type === "number" && fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim() !== "") {
      const numericValue = Number(fieldValue);
      if (!Number.isFinite(numericValue) || numericValue < 1) {
        return `${humanize(field.name)} must be at least 1.`;
      }
    }
  }
  return null;
}

function hasListingUrlAndImageInputs(fields: DemoSchemaField[]) {
  const hasImages = fields.some((field) => field.name === "images" && field.type === "file");
  const hasUrl = fields.some((field) => field.name === "url" && field.type === "url");
  return hasImages && hasUrl;
}

function isListingSiteBlockedMessage(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("blocked automated access") || normalized.includes("uploading photos directly instead");
}

function extractErrorMessage(data: unknown, status: number) {
  if (typeof data === "object" && data) {
    const payload = data as {
      message?: unknown;
      error?: unknown;
      details?: Array<{ message?: unknown }>;
    };

    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }

    if (Array.isArray(payload.details) && payload.details.length > 0) {
      const firstDetail = payload.details[0];
      if (typeof firstDetail?.message === "string" && firstDetail.message.trim()) {
        return firstDetail.message;
      }
    }

    if (
      typeof payload.error === "object" &&
      payload.error &&
      "message" in payload.error &&
      typeof (payload.error as { message?: unknown }).message === "string"
    ) {
      return String((payload.error as { message?: unknown }).message ?? "");
    }
  }

  return `The demo request failed with status ${status}.`;
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }
  const text = await response.text();
  return normalizeGatewayErrorPage(text, response.status, contentType) ?? text;
}

function normalizeGatewayErrorPage(body: string, status: number, contentType: string) {
  if (!contentType.includes("text/html") || status < 500) {
    return null;
  }

  const normalized = body.toLowerCase();
  const looksLikeGatewayPage =
    normalized.includes("bad gateway") ||
    normalized.includes(">502<") ||
    normalized.includes("service is currently unavailable");

  if (!looksLikeGatewayPage) {
    return null;
  }

  const platform = normalized.includes("powered by render")
    ? "Render"
    : normalized.includes("powered by vercel")
      ? "Vercel"
      : null;
  const platformRequestId = body.match(/Request ID:\s*([^\s<]+)/i)?.[1] ?? null;

  return {
    error: {
      code: status === 504 ? "TOOL_TIMEOUT" : "TOOL_UNAVAILABLE",
      message:
        status === 504
          ? "The service took too long to respond. Please try again in a minute."
          : "The service is temporarily unavailable and may be redeploying. Please try again in a minute.",
      platform,
      requestId: platformRequestId,
    },
  };
}

function extractImageValue(data: unknown) {
  if (typeof data === "string") {
    return data;
  }
  if (typeof data === "object" && data && "image_url" in data) {
    return String((data as { image_url?: unknown }).image_url ?? "");
  }
  return null;
}

function extractFileValue(data: unknown) {
  if (typeof data === "string") {
    return data;
  }
  if (typeof data === "object" && data && "file_url" in data) {
    return String((data as { file_url?: unknown }).file_url ?? "");
  }
  return null;
}

function smartDefault(field: DemoSchemaField): string | number | null {
  if (field.type === "file" || field.type === "url") return null;
  if (field.type === "number") return 42;
  const n = field.name.toLowerCase();
  if (n.includes("text") || n.includes("content") || n.includes("input") || n.includes("body"))
    return "The quick brown fox jumps over the lazy dog. This is an automated demo trial.";
  if (n.includes("query") || n.includes("question") || n.includes("search") || n.includes("prompt"))
    return "What can this tool do? Demonstrate its capabilities with this sample query.";
  if (n.includes("message") || n.includes("msg"))
    return "Hello! This is an automated demo message.";
  if (n.includes("code") || n.includes("script") || n.includes("source"))
    return "def hello():\n    print('Hello, World!')";
  if (n.includes("description") || n.includes("desc"))
    return "A sample product for automated demo testing purposes.";
  if (n.includes("name") || n.includes("title"))
    return "Demo Sample";
  if (n.includes("email"))
    return "demo@example.com";
  if (n.includes("lang") || n.includes("language"))
    return "en";
  return field.placeholder && field.placeholder.length > 3 && field.placeholder !== field.name
    ? field.placeholder
    : "sample input";
}

function readSessionCount() {
  if (typeof window === "undefined") {
    return 0;
  }
  return Number(window.sessionStorage.getItem(STORAGE_KEY) ?? "0");
}

function incrementSessionCount() {
  if (typeof window === "undefined") {
    return;
  }
  const next = readSessionCount() + 1;
  window.sessionStorage.setItem(STORAGE_KEY, String(next));
}

function defaultStringValue(schema: DemoInputSchema) {
  const example = schema.example ?? schema.example_input;
  return typeof example === "string" ? example : "";
}

function defaultJsonValue(schema: DemoInputSchema) {
  const example = schema.example ?? schema.example_input;
  if (typeof example === "string") {
    return example;
  }
  if (example !== undefined) {
    return JSON.stringify(example, null, 2);
  }
  return "";
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLikelyPropertyListingUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ["zillow.com", "redfin.com", "realtor.com", "mls.com"].some((domain) => hostname.includes(domain));
  } catch {
    return false;
  }
}
