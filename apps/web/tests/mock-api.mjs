import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 8009;
const allowedOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);

const tool = {
  id: "00000000-0000-4000-8000-000000000001",
  seller_id: "00000000-0000-4000-8000-000000000002",
  seller: {
    id: "00000000-0000-4000-8000-000000000002",
    display_name: "Test Seller",
    avatar_url: null,
    username: "test-seller",
  },
  name: "Document Signal Extractor",
  slug: "document-signal-extractor",
  tagline: "Extract structured signals from unstructured documents.",
  description: "A deterministic browser-test fixture served by the local test API.",
  category: "nlp",
  status: "live",
  ownership_type: "royalty",
  input_type: "text",
  output_type: "json",
  input_schema: {
    fields: [
      {
        name: "text",
        type: "string",
        label: "Document text",
        placeholder: "Paste a document",
        required: true,
      },
    ],
  },
  output_schema: {
    fields: [{ name: "signals", type: "array" }],
  },
  environment_variables: null,
  source_file_tree: null,
  price_per_request: "0.004000",
  one_time_price: null,
  demo_url: null,
  api_endpoint: null,
  docker_image_uri: null,
  github_url: "https://github.com/sammcheng/startup1",
  source_s3_key: null,
  config_s3_key: null,
  entry_command: "python app.py",
  port: 8000,
  processing_error: null,
  documentation: "Send document text and receive structured signals.",
  avg_response_time_ms: 84,
  total_requests: 128,
  uptime_percentage: "99.90",
  is_featured: true,
  view_count: 12,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-HackMarket-Request-Id");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  if (url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/tools") {
    sendJson(response, 200, { items: [tool], total: 1, page: 1, limit: 20, pages: 1 });
    return;
  }
  if (request.method === "GET" && url.pathname === `/v1/tools/${tool.slug}`) {
    sendJson(response, 200, tool);
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/tools/discover") {
    await consumeRequest(request);
    sendJson(response, 200, {
      matches: [{ tool, fit_line: "Matches document signal extraction", match_score: 1, matched_keywords: ["document"] }],
      query: "document",
    });
    return;
  }

  sendJson(response, 404, { error: { code: "not_found", message: "Not found" } });
});

server.listen(port, host);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function consumeRequest(request) {
  for await (const _chunk of request) {
    // Drain the request so the client can reuse the connection.
  }
}
