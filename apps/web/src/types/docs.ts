export type DocumentationLanguage = "curl" | "python" | "javascript" | "nodejs";

export interface DocumentationCodeExample {
  language: DocumentationLanguage;
  label: string;
  code: string;
}

export interface DocumentationSection {
  title: string;
  body: string;
}

export interface ToolDocumentation {
  tool_id: string;
  tool_slug: string;
  tool_name: string;
  endpoint_url: string;
  method: string;
  authentication: DocumentationSection;
  request_format: DocumentationSection;
  response_format: DocumentationSection;
  rate_limit: DocumentationSection;
  error_codes: Array<{
    status: number;
    code: string;
    meaning: string;
  }>;
  request_example: Record<string, unknown> | unknown[] | string;
  response_example: Record<string, unknown> | unknown[] | string;
  code_examples: DocumentationCodeExample[];
}
