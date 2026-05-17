"use client";

import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import Icon from "./Icon";
import { Pipeline } from "./DemoShared";

// ─── Pre-loaded sample documents ─────────────────────────────────────────

const SAMPLES: Record<string, string> = {
  'refund-policy.txt': `Refund Policy - Acme Corp

We offer a full refund within 30 days of purchase for all products. To request a refund, contact our support team with your order number. Refunds are processed within 5-7 business days after approval.

For digital products, refunds are available within 14 days if the product has not been downloaded more than twice. Subscription refunds are prorated based on remaining days in the billing cycle.

Items purchased during promotional sales are eligible for store credit only, not cash refunds. Gift card purchases are non-refundable.

For defective products, we offer full refunds regardless of the purchase date. Please include photos of the defect when submitting your request.`,
  'shipping-faq.txt': `Shipping FAQ - Acme Corp

Standard shipping takes 5-7 business days within the continental US. Express shipping (2-3 days) is available for an additional $12.99. Overnight shipping is $24.99.

International orders ship within 10-15 business days. Customs fees and duties are the responsibility of the recipient. We ship to over 40 countries.

Free shipping is available on orders over $50. This applies to standard shipping only. During holiday sales, the free shipping threshold may be temporarily reduced to $35.

All orders include tracking. You will receive a tracking number via email within 24 hours of shipment. For any shipping issues, contact support@acme.com.

Returns must be shipped back at the customer's expense unless the item is defective. We provide a prepaid return label for defective items.`,
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'that',
  'this', 'these', 'those', 'and', 'or', 'but', 'not', 'no', 'do', 'does',
  'did', 'will', 'would', 'should', 'could', 'can', 'about', 'how', 'what',
  'when', 'where', 'why', 'who', 'which', 'your', 'you', 'my', 'me', 'i',
]);

interface SourceKey {
  file: string;
  find: string;
}

interface PresetQA {
  match: (q: string) => boolean;
  answer: string;
  sourceKeys: SourceKey[];
}

const PRESET_QA: PresetQA[] = [
  {
    match: (q) => /\brefund\s+polic(y|ies)\b/i.test(q)
              || (/\brefund/i.test(q) && !/\b(digital|download)/i.test(q)),
    answer:
      "Our refund policy offers a full refund within 30 days of purchase for all products. To request a refund, contact support with your order number — refunds are processed within 5-7 business days after approval. Defective products can be refunded regardless of purchase date.",
    sourceKeys: [
      { file: 'refund-policy.txt', find: 'full refund within 30 days' },
      { file: 'refund-policy.txt', find: 'defective products' },
    ],
  },
  {
    match: (q) => /\b(how long|days|time)\b.*\bship/i.test(q)
              || /\bship.*\b(take|long|days|time)/i.test(q)
              || /\bshipping time\b/i.test(q),
    answer:
      "Standard shipping is 5-7 business days within the continental US. Express (2-3 days) is $12.99, and overnight is $24.99. International orders ship in 10-15 business days.",
    sourceKeys: [
      { file: 'shipping-faq.txt', find: 'standard shipping takes 5-7' },
    ],
  },
  {
    match: (q) => /\bfree shipping\b/i.test(q) || /\bshipping (cost|fee|price)/i.test(q),
    answer:
      "Free standard shipping is available on orders over $50. During holiday sales, the threshold can temporarily drop to $35. Express and overnight remain paid options at any order size.",
    sourceKeys: [
      { file: 'shipping-faq.txt', find: 'free shipping is available' },
    ],
  },
  {
    match: (q) => /\b(digital|download)/i.test(q) && /\brefund|return/i.test(q),
    answer:
      "Digital product refunds are available within 14 days, but only if the product hasn't been downloaded more than twice. Subscription refunds are prorated for the remaining days in the billing cycle.",
    sourceKeys: [
      { file: 'refund-policy.txt', find: 'digital products' },
    ],
  },
];

// ─── Types ───────────────────────────────────────────────────────────────

interface DocFile {
  name: string;
  size: number;
  content?: string;
  isPdf: boolean;
}

interface Chunk {
  file: string;
  idx: number;
  text: string;
}

interface ScoredChunk extends Chunk {
  hits?: number;
  relevance: number;
}

interface QueryResult {
  answer: string;
  sources: ScoredChunk[];
}

interface ProcStep {
  label: string;
  ms: number;
  doneText: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function chunkText(text: string, filename: string): Chunk[] {
  const paragraphs = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  for (const p of paragraphs) {
    const words = p.split(/\s+/);
    if (words.length <= 90) {
      chunks.push({ file: filename, idx: chunks.length, text: p });
    } else {
      for (let i = 0; i < words.length; i += 60) {
        chunks.push({ file: filename, idx: chunks.length, text: words.slice(i, i + 60).join(' ') });
      }
    }
  }
  return chunks;
}

function fakePdfChunks(filename: string, sizeBytes: number): Chunk[] {
  const n = Math.max(3, Math.min(20, Math.round(sizeBytes / 1024)));
  return Array.from({ length: n }, (_, i) => ({
    file: filename,
    idx: i,
    text: `[Page ${i + 1} of ${filename} — content extracted from PDF]`,
  }));
}

function queryKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && w.length > 2 && !STOP_WORDS.has(w));
}

function highlightChunkText(text: string, query: string): ReactNode {
  const words = queryKeywords(query);
  if (words.length === 0) return text;
  const pattern = new RegExp(`\\b(${words.map(escapeRegex).join('|')})\\b`, 'gi');
  const parts: { t: string; hit: boolean }[] = [];
  let lastIdx = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ t: text.slice(lastIdx, m.index), hit: false });
    parts.push({ t: m[0], hit: true });
    lastIdx = m.index + m[0].length;
    if (m.index === pattern.lastIndex) pattern.lastIndex++;
  }
  if (lastIdx < text.length) parts.push({ t: text.slice(lastIdx), hit: false });
  return parts.map((p, i) => p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>);
}

function findPresetMatch(query: string, chunks: Chunk[], usingSamples: boolean): QueryResult | null {
  if (!usingSamples) return null;
  for (const qa of PRESET_QA) {
    if (qa.match(query)) {
      const sources: ScoredChunk[] = [];
      for (const key of qa.sourceKeys) {
        const c = chunks.find(
          (ch) => ch.file === key.file && ch.text.toLowerCase().includes(key.find.toLowerCase())
        );
        if (c) sources.push({ ...c, relevance: 0.88 + Math.random() * 0.09 });
      }
      return { answer: qa.answer, sources: sources.slice(0, 3) };
    }
  }
  return null;
}

function keywordSearch(query: string, chunks: Chunk[]): ScoredChunk[] {
  const words = queryKeywords(query);
  if (words.length === 0) return [];
  const scored = chunks.map((c) => {
    const lower = c.text.toLowerCase();
    let hits = 0;
    for (const w of words) {
      if (lower.includes(w)) hits++;
    }
    return { ...c, hits };
  });
  return scored
    .filter((c) => c.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3)
    .map((c) => ({ ...c, relevance: Math.min(0.96, 0.62 + c.hits * 0.08) }));
}

function genericAnswer(query: string, chunks: Chunk[]): QueryResult {
  const top = keywordSearch(query, chunks);
  if (top.length === 0) {
    return {
      answer: "I couldn't find specific information about that in the uploaded documents. Try rephrasing or uploading more relevant material.",
      sources: [],
    };
  }
  const summary = top[0].text.length > 240
    ? top[0].text.slice(0, 240).trim() + '…'
    : top[0].text;
  return {
    answer: `Based on the uploaded documents: ${summary}`,
    sources: top,
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return n + ' B';
  return (n / 1024).toFixed(1) + ' KB';
}

const PROC_STEPS_TPL = (n: number): ProcStep[] => [
  { label: 'Chunking documents',    ms: 1500, doneText: `Split into ${n} chunks` },
  { label: 'Generating embeddings', ms: 2000, doneText: `${n} vectors generated` },
  { label: 'Indexing vectors',      ms: 800,  doneText: 'FAISS index built' },
  { label: 'Ready for queries',     ms: 200,  doneText: 'Ready' },
];

const QUERY_STEPS = [
  { label: 'Parsing query',         ms: 120 },
  { label: 'Embedding query',       ms: 85 },
  { label: 'Searching index',       ms: 34 },
  { label: 'Ranking top matches',   ms: 12 },
  { label: 'Generating response',   ms: 340 },
];

// ─── Phase transition variants ──────────────────────────────────────────

const phaseFade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
  transition: { duration: 0.28, ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number] },
};

// Pipeline (dot row + active-step label) lives in DemoShared so the
// other 9 module demos share the same implementation.

// ─── Component ───────────────────────────────────────────────────────────

export default function VectorVaultDemo() {
  // 'upload' → drop zone + samples + file list
  // 'processing' → file summary + 4-step pipeline; once all done, query input slides in
  // 'query' → compact summary at top + query input + execution pipeline + results
  const [phase, setPhase] = useState<'upload' | 'processing' | 'query'>('upload');

  const [files, setFiles] = useState<DocFile[]>([]);
  const [usingSamples, setUsingSamples] = useState<boolean>(false);

  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [procStep, setProcStep] = useState<number>(0);
  const [procReady, setProcReady] = useState<boolean>(false);

  const [query, setQuery] = useState<string>('');
  const [queryRunning, setQueryRunning] = useState<boolean>(false);
  const [qStep, setQStep] = useState<number>(-1);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [lastQuery, setLastQuery] = useState<string>('');
  const [resultKey, setResultKey] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dragCountRef = useRef<number>(0);
  const [dragOver, setDragOver] = useState<boolean>(false);

  function clearTimers() {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }
  useEffect(() => () => clearTimers(), []);

  // ── File handling ────────────────────────────────────────

  function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  async function addFiles(fileList: FileList) {
    const incoming = Array.from(fileList).slice(0, 3 - files.length);
    if (incoming.length === 0) return;
    const next: DocFile[] = [];
    for (const f of incoming) {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      const isPdf = ext === 'pdf';
      const isText = ['txt', 'md', 'markdown'].includes(ext);
      let content: string | undefined;
      if (isText) {
        try { content = await readFileAsText(f); } catch { /* ignore */ }
      }
      next.push({ name: f.name, size: f.size, content, isPdf });
    }
    setFiles((prev) => [...prev, ...next].slice(0, 3));
    setUsingSamples(false);
  }

  function loadSamples() {
    setFiles(Object.entries(SAMPLES).map(([name, content]) => ({
      name, size: content.length, content, isPdf: false,
    })));
    setUsingSamples(true);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragCountRef.current = 0;
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }

  // ── Processing pipeline ──────────────────────────────────

  function startProcessing() {
    if (files.length === 0) return;
    clearTimers();

    const allChunks = files.flatMap((f) =>
      f.content ? chunkText(f.content, f.name) : fakePdfChunks(f.name, f.size)
    );
    setChunks(allChunks);
    setProcStep(0);
    setProcReady(false);
    setResult(null);
    setQStep(-1);
    setPhase('processing');

    const steps = PROC_STEPS_TPL(allChunks.length);
    let cumulative = 0;
    steps.forEach((_, i) => {
      cumulative += steps[i].ms;
      timersRef.current.push(setTimeout(() => setProcStep(i + 1), cumulative));
    });
    timersRef.current.push(setTimeout(() => setProcReady(true), cumulative + 220));
  }

  // ── Query pipeline ───────────────────────────────────────

  function runQuery() {
    if (queryRunning || !query.trim()) return;
    clearTimers();

    setQueryRunning(true);
    setResult(null);

    const q = query;
    setLastQuery(q);

    // Eager compute so the UI can reveal at pipeline end.
    const preset = findPresetMatch(q, chunks, usingSamples);
    const computed = preset || genericAnswer(q, chunks);

    // First-time transition to phase 'query'; subsequent searches stay in phase.
    if (phase !== 'query') setPhase('query');

    setQStep(0);
    let cumulative = 0;
    QUERY_STEPS.forEach((s, i) => {
      cumulative += s.ms;
      timersRef.current.push(setTimeout(() => setQStep(i + 1), cumulative));
    });
    timersRef.current.push(setTimeout(() => {
      setResult(computed);
      setResultKey((k) => k + 1);
      setQueryRunning(false);
    }, cumulative + 220));
  }

  // ── Derived values ───────────────────────────────────────

  const procSteps = PROC_STEPS_TPL(chunks.length);
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const fileSummary = files.length > 0
    ? `${files.length} file${files.length === 1 ? '' : 's'} · ${formatBytes(totalSize)}`
    : '';

  const breadcrumbState = (target: 'upload' | 'processing' | 'query') => {
    const order = ['upload', 'processing', 'query'];
    const cur = order.indexOf(phase);
    const tgt = order.indexOf(target);
    if (tgt < cur) return 'done';
    if (tgt === cur) return 'active';
    return 'pending';
  };

  return (
    <div className="kc-demo-scope vv-demo">
      {/* Breadcrumb */}
      <div className="vv-crumb">
        <div className={`vv-crumb-step ${breadcrumbState('upload')}`}>
          <span className="vv-crumb-num">1</span>
          <span>Upload</span>
        </div>
        <span className="vv-crumb-sep" />
        <div className={`vv-crumb-step ${breadcrumbState('processing')}`}>
          <span className="vv-crumb-num">2</span>
          <span>Process</span>
        </div>
        <span className="vv-crumb-sep" />
        <div className={`vv-crumb-step ${breadcrumbState('query')}`}>
          <span className="vv-crumb-num">3</span>
          <span>Query</span>
        </div>
      </div>

      {/* Fixed-height stage; phases swap inside via AnimatePresence */}
      <div className="vv-stage">
        <AnimatePresence mode="wait">
          {phase === 'upload' && (
            <motion.div key="upload" className="vv-phase" {...phaseFade}>
              <UploadPhase
                files={files}
                dragOver={dragOver}
                setDragOver={setDragOver}
                dragCountRef={dragCountRef}
                fileInputRef={fileInputRef}
                addFiles={addFiles}
                removeFile={removeFile}
                loadSamples={loadSamples}
                onDrop={onDrop}
                onProcess={startProcessing}
              />
            </motion.div>
          )}

          {phase === 'processing' && (
            <motion.div key="processing" className="vv-phase" {...phaseFade}>
              <ProcessingPhase
                fileSummary={fileSummary}
                steps={procSteps}
                procStep={procStep}
                procReady={procReady}
                query={query}
                setQuery={setQuery}
                onSearch={runQuery}
                queryRunning={queryRunning}
                usingSamples={usingSamples}
              />
            </motion.div>
          )}

          {phase === 'query' && (
            <motion.div key="query" className="vv-phase" {...phaseFade}>
              <QueryPhase
                chunkCount={chunks.length}
                query={query}
                setQuery={setQuery}
                onSearch={runQuery}
                queryRunning={queryRunning}
                qStep={qStep}
                result={result}
                lastQuery={lastQuery}
                resultKey={resultKey}
                usingSamples={usingSamples}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Phase 1: Upload ────────────────────────────────────────────────────

interface UploadPhaseProps {
  files: DocFile[];
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  dragCountRef: MutableRefObject<number>;
  fileInputRef: any;
  addFiles: (fl: FileList) => void;
  removeFile: (idx: number) => void;
  loadSamples: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onProcess: () => void;
}

function UploadPhase({
  files, dragOver, setDragOver, dragCountRef, fileInputRef,
  addFiles, removeFile, loadSamples, onDrop, onProcess,
}: UploadPhaseProps) {
  function onDragOver(e: React.DragEvent<HTMLDivElement>) { e.preventDefault(); }
  function onDragEnter(e: React.DragEvent<HTMLDivElement>) { e.preventDefault(); dragCountRef.current += 1; setDragOver(true); }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault(); dragCountRef.current -= 1;
    if (dragCountRef.current <= 0) setDragOver(false);
  }

  return (
    <div className="vv-phase-body">
      <div
        className={`vv-dropzone ${dragOver ? 'over' : ''} ${files.length >= 3 ? 'full' : ''}`}
        onClick={() => files.length < 3 && fileInputRef.current?.click()}
        onDrop={onDrop} onDragOver={onDragOver}
        onDragEnter={onDragEnter} onDragLeave={onDragLeave}
      >
        <div className="vv-dropzone-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className="vv-dropzone-text"><b>Drop files here</b> or click to browse</div>
        <div className="vv-dropzone-sub">PDF, TXT, MD — up to 3 files</div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.markdown,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {files.length === 0 && (
        <button className="vv-sample-btn" onClick={loadSamples}>
          <Icon name="sparkle" size={12} color="var(--primary)" />
          Or try with our sample documents
        </button>
      )}

      {files.length > 0 && (
        <ul className="vv-file-list">
          {files.map((f, i) => (
            <li key={f.name + i} className="vv-file">
              <span className="vv-file-icon">📄</span>
              <span className="vv-file-name">{f.name}</span>
              <span className="vv-file-size">{(f.size / 1024).toFixed(1)} KB</span>
              <button className="vv-file-remove" onClick={() => removeFile(i)} title="Remove">
                <Icon name="x" size={11} stroke={2.6} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="vv-phase-footer">
        <button
          className="btn btn-vermillion"
          onClick={onProcess}
          disabled={files.length === 0}
          style={{ opacity: files.length === 0 ? 0.5 : 1, pointerEvents: files.length === 0 ? 'none' : 'auto' }}
        >
          Process &amp; index <Icon name="arrow-right" size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Phase 2: Processing ────────────────────────────────────────────────

interface ProcessingPhaseProps {
  fileSummary: string;
  steps: ProcStep[];
  procStep: number;
  procReady: boolean;
  query: string;
  setQuery: (q: string) => void;
  onSearch: () => void;
  queryRunning: boolean;
  usingSamples: boolean;
}

function ProcessingPhase({
  fileSummary, steps, procStep, procReady, query, setQuery,
  onSearch, queryRunning, usingSamples,
}: ProcessingPhaseProps) {
  return (
    <div className="vv-phase-body">
      <div className="vv-summary-line">
        <span className="vv-summary-k">Files</span>
        <span className="vv-summary-v">{fileSummary}</span>
      </div>

      <Pipeline steps={steps} currentIdx={procStep} complete={procReady} />


      <AnimatePresence>
        {procReady && (
          <motion.div
            className="vv-ready-block"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28 }}
          >
            <div className="vv-summary-line vv-summary-line-success">
              <span className="vv-pill-good"><Icon name="check" size={10} stroke={3} /> Ready</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Ask anything about your documents.</span>
            </div>
            <QueryBar
              query={query}
              setQuery={setQuery}
              onSearch={onSearch}
              queryRunning={queryRunning}
              autoFocus
            />
            {usingSamples && <SuggestedChips setQuery={setQuery} disabled={queryRunning} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Phase 3: Query + Results ───────────────────────────────────────────

interface QueryPhaseProps {
  chunkCount: number;
  query: string;
  setQuery: (q: string) => void;
  onSearch: () => void;
  queryRunning: boolean;
  qStep: number;
  result: QueryResult | null;
  lastQuery: string;
  resultKey: number;
  usingSamples: boolean;
}

function QueryPhase({
  chunkCount, query, setQuery, onSearch, queryRunning, qStep,
  result, lastQuery, resultKey, usingSamples,
}: QueryPhaseProps) {
  return (
    <div className="vv-phase-body">
      {/* Pinned query bar */}
      <div className="vv-query-pinned">
        <QueryBar
          query={query}
          setQuery={setQuery}
          onSearch={onSearch}
          queryRunning={queryRunning}
          autoFocus={false}
        />
        {usingSamples && <SuggestedChips setQuery={setQuery} disabled={queryRunning} />}
      </div>

      {/* Dots row sits directly beneath the search bar — the first thing
          you see after submitting. The active step label (if any) sits
          below the dots so the row never shifts. */}
      <Pipeline
        steps={QUERY_STEPS}
        currentIdx={qStep}
        complete={Boolean(result) && !queryRunning}
        labelOverride={{
          2: `Searching ${chunkCount} chunks`,
          3: result ? `Top ${Math.max(1, result.sources.length || 3)} results found` : 'Ranking top matches',
        }}
      />

      {/* Result block (replaces on each new query) */}
      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={resultKey}
            className="vv-result-block"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28 }}
          >
            <AnswerBlock answer={result.answer} />
            {result.sources.length > 0 && (
              <SourceRow sources={result.sources} query={lastQuery} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────

interface QueryBarProps {
  query: string;
  setQuery: (q: string) => void;
  onSearch: () => void;
  queryRunning: boolean;
  autoFocus: boolean;
}

function QueryBar({ query, setQuery, onSearch, queryRunning, autoFocus }: QueryBarProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (autoFocus) setTimeout(() => ref.current?.focus(), 60);
  }, [autoFocus]);
  return (
    <div className="vv-query-row">
      <input
        ref={ref}
        className="vv-query-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
        placeholder="Ask a question about your documents…"
      />
      <button
        className="btn btn-vermillion vv-query-btn"
        onClick={onSearch}
        disabled={queryRunning || !query.trim()}
      >
        {queryRunning ? 'Searching…' : (<>Search <Icon name="arrow-right" size={13} /></>)}
      </button>
    </div>
  );
}

const SUGGESTIONS = [
  'What is the refund policy?',
  'How long does shipping take?',
  'Do you offer free shipping?',
  'Can I return digital products?',
];

interface SuggestedChipsProps {
  setQuery: (q: string) => void;
  disabled: boolean;
}

function SuggestedChips({ setQuery, disabled }: SuggestedChipsProps) {
  return (
    <div className="vv-suggested">
      {SUGGESTIONS.map((s) => (
        <button key={s} className="vv-suggest-chip" onClick={() => setQuery(s)} disabled={disabled}>
          {s}
        </button>
      ))}
    </div>
  );
}

interface AnswerBlockProps {
  answer: string;
}

function AnswerBlock({ answer }: AnswerBlockProps) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const isLong = answer.length > 180;
  const visible = !isLong || expanded ? answer : answer.slice(0, 180).trimEnd() + '…';
  return (
    <div>
      <div className="vv-answer-label">Answer</div>
      <div className="vv-answer">{visible}</div>
      {isLong && (
        <button className="vv-answer-toggle" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less ▴' : 'Show full answer ▾'}
        </button>
      )}
    </div>
  );
}

// Compact vertical accordion. Default state shows each source as a single
// row (filename, chunk #, relevance). Click to expand inline; only one row
// open at a time.
interface SourceRowProps {
  sources: ScoredChunk[];
  query: string;
}

function SourceRow({ sources, query }: SourceRowProps) {
  // Auto-expand the first source on mount so users immediately see what
  // a chunk looks like. The result block above is keyed by query, so this
  // re-initializes on every new search.
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <div>
      <div className="vv-answer-label" style={{ marginTop: 10 }}>Sources</div>
      <ul className="vv-source-list">
        {sources.map((s, i) => {
          const open = openIdx === i;
          return (
            <li key={s.file + s.idx + '-' + i} className={`vv-source-item ${open ? 'open' : ''}`}>
              <button
                className="vv-source-summary"
                onClick={() => setOpenIdx(open ? null : i)}
                aria-expanded={open}
              >
                <span className="vv-source-summary-file">{s.file}</span>
                <span className="vv-source-summary-chunk">chunk {s.idx + 1}</span>
                <span className="vv-source-summary-relev">{s.relevance.toFixed(2)}</span>
                <span className="vv-source-summary-toggle">{open ? '▴' : '▾'}</span>
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    className="vv-source-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
                  >
                    <div className="vv-source-body-inner">
                      {highlightChunkText(s.text, query)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
