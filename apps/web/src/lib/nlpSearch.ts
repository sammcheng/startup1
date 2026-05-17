// NLP search engine — ported from KC's matchModules/tokenize approach,
// adapted for Hackmarket's tool categories.

import type { Tool } from "@/types/tool";

// Longer phrases first within each category for greedy matching.
export const KEYWORD_CATEGORY: [string, string][] = [
  // NLP
  ["natural language processing", "nlp"],
  ["sentiment analysis", "nlp"],
  ["text classification", "nlp"],
  ["named entity recognition", "nlp"],
  ["text summarization", "nlp"],
  ["machine translation", "nlp"],
  ["language model", "nlp"],
  ["text analysis", "nlp"],
  ["question answering", "nlp"],
  ["summarize", "nlp"], ["summarizer", "nlp"], ["summary", "nlp"],
  ["translate", "nlp"], ["translation", "nlp"],
  ["sentiment", "nlp"], ["chatbot", "nlp"],
  ["embedding", "nlp"], ["semantic", "nlp"],
  ["language", "nlp"], ["nlp", "nlp"],
  ["llm", "nlp"], ["gpt", "nlp"],
  ["text", "nlp"], ["speech", "nlp"],

  // Computer Vision
  ["object detection", "computer_vision"],
  ["image classification", "computer_vision"],
  ["face recognition", "computer_vision"],
  ["image segmentation", "computer_vision"],
  ["optical character recognition", "computer_vision"],
  ["computer vision", "computer_vision"],
  ["image recognition", "computer_vision"],
  ["visual search", "computer_vision"],
  ["image analysis", "computer_vision"],
  ["ocr", "computer_vision"],
  ["vision", "computer_vision"], ["detect", "computer_vision"],
  ["image", "computer_vision"], ["photo", "computer_vision"],
  ["video", "computer_vision"], ["visual", "computer_vision"],
  ["camera", "computer_vision"], ["frame", "computer_vision"],

  // Data Analysis
  ["predictive analytics", "data_analysis"],
  ["anomaly detection", "data_analysis"],
  ["time series", "data_analysis"],
  ["data visualization", "data_analysis"],
  ["data analysis", "data_analysis"],
  ["data pipeline", "data_analysis"],
  ["machine learning", "data_analysis"],
  ["forecast", "data_analysis"], ["prediction", "data_analysis"],
  ["analytics", "data_analysis"], ["statistics", "data_analysis"],
  ["analyze", "data_analysis"], ["analysis", "data_analysis"],
  ["dataset", "data_analysis"], ["csv", "data_analysis"],
  ["chart", "data_analysis"], ["graph", "data_analysis"],
  ["metrics", "data_analysis"], ["insight", "data_analysis"],
  ["ml", "data_analysis"], ["model", "data_analysis"],

  // Automation
  ["workflow automation", "automation"],
  ["task automation", "automation"],
  ["robotic process", "automation"],
  ["web scraping", "automation"],
  ["batch processing", "automation"],
  ["automate", "automation"], ["automation", "automation"],
  ["workflow", "automation"], ["pipeline", "automation"],
  ["schedule", "automation"], ["trigger", "automation"],
  ["webhook", "automation"], ["scrape", "automation"],
  ["extract", "automation"], ["crawl", "automation"],
  ["bot", "automation"], ["process", "automation"],

  // Generation
  ["code generation", "generation"],
  ["image generation", "generation"],
  ["text generation", "generation"],
  ["content generation", "generation"],
  ["generate", "generation"], ["generation", "generation"],
  ["write", "generation"], ["writing", "generation"],
  ["draft", "generation"], ["compose", "generation"],
  ["create content", "generation"],
  ["art", "generation"], ["music", "generation"],
  ["design", "generation"], ["diffusion", "generation"],
];

export interface Segment {
  type: "text" | "tag";
  value: string;
  cat?: string;
}

export const NLP_CATEGORIES = [
  { id: "nlp", label: "NLP" },
  { id: "computer_vision", label: "Vision" },
  { id: "data_analysis", label: "Data" },
  { id: "automation", label: "Automation" },
  { id: "generation", label: "Generation" },
];

export const CATEGORY_LABELS: Record<string, string> = {
  nlp: "NLP",
  computer_vision: "Computer Vision",
  data_analysis: "Data Analysis",
  automation: "Automation",
  generation: "Generation",
  other: "Other",
};

// Greedy longest-match tokenizer — ported from KC's modules.jsx
export function tokenize(text: string): Segment[] {
  if (!text) return [];
  const sorted = [...KEYWORD_CATEGORY].sort((a, b) => b[0].length - a[0].length);
  const segs: Segment[] = [];
  let i = 0;
  const lower = text.toLowerCase();
  const isWordChar = (c: string) => /[a-z0-9]/i.test(c);

  while (i < text.length) {
    let matched: [string, string] | null = null;
    for (const [kw, cat] of sorted) {
      if (lower.startsWith(kw, i)) {
        const before = i === 0 ? " " : text[i - 1];
        const after = text[i + kw.length] ?? " ";
        if (!isWordChar(before) && !isWordChar(after)) {
          matched = [kw, cat];
          break;
        }
      }
    }
    if (matched) {
      const [kw, cat] = matched;
      segs.push({ type: "tag", value: text.slice(i, i + kw.length), cat });
      i += kw.length;
    } else {
      let j = i + 1;
      while (j < text.length) {
        let hit = false;
        for (const [kw] of sorted) {
          if (lower.startsWith(kw, j)) {
            const before = j === 0 ? " " : text[j - 1];
            const after = text[j + kw.length] ?? " ";
            if (!isWordChar(before) && !isWordChar(after)) {
              hit = true;
              break;
            }
          }
        }
        if (hit) break;
        j++;
      }
      segs.push({ type: "text", value: text.slice(i, j) });
      i = j;
    }
  }

  // Merge consecutive text segments
  const out: Segment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (s.type === "text" && last?.type === "text") {
      last.value += s.value;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

export function segmentsToText(segs: Segment[]): string {
  return segs.map((s) => s.value).join("");
}

export interface ScoredTool {
  tool: Tool;
  score: number;
  fit: string;
  hits: string[];
  fallback?: boolean;
}

export function matchTools(segments: Segment[], tools: Tool[]): ScoredTool[] {
  const flatText = segmentsToText(segments).toLowerCase();
  if (!flatText.trim() || tools.length === 0) return [];

  const tagCats = new Set(
    segments.filter((s) => s.type === "tag" && s.cat).map((s) => s.cat as string)
  );

  const scored = tools
    .map((tool) => {
      let score = 0;
      const hits: string[] = [];

      // Category match bonus
      if (tagCats.has(tool.category)) score += 4;

      const corpus = [
        tool.name.toLowerCase(),
        (tool.tagline ?? "").toLowerCase(),
        (tool.description ?? "").toLowerCase(),
        tool.category.replace(/_/g, " ").toLowerCase(),
      ].join(" ");

      for (const [kw] of KEYWORD_CATEGORY) {
        if (flatText.includes(kw) && corpus.includes(kw)) {
          score += kw.split(" ").length * 2;
          hits.push(kw);
        }
      }

      // Free-text word overlap
      for (const w of flatText.split(/\s+/).filter((w) => w.length > 2)) {
        if (corpus.includes(w)) score += 1;
      }

      return { tool, score, hits };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.tool.total_requests ?? 0) - (a.tool.total_requests ?? 0)
    );

  if (scored.length === 0) {
    return tools.slice(0, 6).map((tool) => ({
      tool,
      score: 0,
      fit: `Available in the Hackmarket catalog.`,
      hits: [],
      fallback: true,
    }));
  }

  const maxScore = scored[0].score;
  return scored.slice(0, 8).map(({ tool, score, hits }) => ({
    tool,
    score: Math.round((score / maxScore) * 100),
    hits,
    fit: generateFit(tool, flatText, hits),
  }));
}

function generateFit(tool: Tool, query: string, hits: string[]): string {
  const name = tool.name;
  const cat = CATEGORY_LABELS[tool.category] ?? tool.category;
  if (hits.length === 0) return `${name} is a ${cat} tool available in the catalog.`;

  const h = hits[0];
  if (h.includes("summar")) return `${name} summarizes your content and surfaces key points on demand.`;
  if (h.includes("translat")) return `${name} handles language translation for your content pipeline.`;
  if (h.includes("sentiment")) return `${name} classifies the sentiment and tone of your text inputs.`;
  if (h.includes("image") || h.includes("vision") || h.includes("detect") || h.includes("visual"))
    return `${name} provides ${cat.toLowerCase()} capabilities for your visual data pipeline.`;
  if (h.includes("automate") || h.includes("workflow") || h.includes("pipeline"))
    return `${name} automates your ${query.includes("pipeline") ? "pipeline" : "workflow"} with a single API call.`;
  if (h.includes("generat") || h.includes("create") || h.includes("write"))
    return `${name} generates ${cat.toLowerCase()} content on demand for your use case.`;
  if (h.includes("analyz") || h.includes("data") || h.includes("forecast") || h.includes("insight"))
    return `${name} analyzes your data and surfaces actionable insights via a simple API.`;
  if (h.includes("nlp") || h.includes("language") || h.includes("text") || h.includes("llm"))
    return `${name} processes natural language and fits your text analysis requirements.`;

  return `${name} matches your ${h} requirements — integrate it in one API call.`;
}
