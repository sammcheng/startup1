import type { InputType, OutputType } from "@/types/tool";

export type DemoFieldType = "string" | "number" | "file" | "url";

export interface DemoSchemaField {
  name: string;
  type: DemoFieldType;
  required?: boolean;
  label?: string;
  placeholder?: string;
}

export interface DemoInputSchema {
  fields?: DemoSchemaField[];
  placeholder?: string;
  example?: unknown;
  example_input?: unknown;
  qa_inputs?: Record<string, string | number>;
  qa_certified?: boolean;
  qa_avg_ms?: number;
}

export interface DemoInputProps<TValue> {
  label?: string;
  value: TValue;
  onChange: (value: TValue) => void;
  disabled?: boolean;
  error?: string | null;
  placeholder?: string;
}

export interface DemoFileValue {
  name: string;
  content: string;
  mimeType: string;
}

export interface DemoImageValue {
  base64: string;
  previewUrl: string;
  filename: string;
  mimeType?: string;
}

export interface DemoResult {
  data: unknown;
  status: number;
  responseTimeMs: number;
  requestId: string | null;
}

export interface DemoRunnerProps {
  toolSlug: string;
  inputType: InputType | null;
  inputSchema: Record<string, unknown> | null;
  outputType: OutputType | null;
  mockResponse?: unknown;
  demoEndpoint?: string;
  autoRun?: boolean;
}
