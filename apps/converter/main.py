"""
Hackmarket Converter Service
GitHub URL → AI-analyzed API spec → stored tool listing

Endpoints:
  POST /api/analyze          start analysis job, returns {job_id}
  GET  /api/analyze/:id/stream  SSE stream of progress + result
  GET  /api/tools            list all published tools
  GET  /api/tools/:slug      get one tool
  GET  /health               health check
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sqlite3
import subprocess
import tempfile
import uuid
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("converter")

# ── Config ────────────────────────────────────────────────────────────────────

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.1-8b-instant"
DB_PATH = os.environ.get("DB_PATH", "tools.db")
MAX_FILE_BYTES = 3_000
MAX_FILES = 6
MAIN_API_URL = os.environ.get("MAIN_API_URL", "http://localhost:8000")
CONVERTER_SECRET = os.environ.get("CONVERTER_SECRET", "")

SUPPORTED_EXT = {
    ".py",
    ".js",
    ".ts",
    ".go",
    ".rs",
    ".rb",
    ".java",
    ".cpp",
    ".c",
}

SKIP_DIRS = {
    "node_modules",
    ".git",
    "__pycache__",
    "venv",
    ".venv",
    "dist",
    "build",
    ".next",
    "vendor",
    "target",
}

# ── Database ──────────────────────────────────────────────────────────────────


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tools (
                id         TEXT PRIMARY KEY,
                slug       TEXT UNIQUE NOT NULL,
                repo_url   TEXT NOT NULL,
                spec       TEXT NOT NULL,
                created_at TEXT NOT NULL,
                listed     INTEGER NOT NULL DEFAULT 0
            )
        """)
        for migration in [
            "ALTER TABLE tools ADD COLUMN listed INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE tools ADD COLUMN qa_inputs TEXT",
            "ALTER TABLE tools ADD COLUMN qa_avg_ms INTEGER",
            "ALTER TABLE tools ADD COLUMN qa_certified INTEGER DEFAULT 0",
            "ALTER TABLE tools ADD COLUMN review_status TEXT DEFAULT 'draft'",
            "ALTER TABLE tools ADD COLUMN reviewer_notes TEXT",
            "ALTER TABLE tools ADD COLUMN pdf_summary TEXT",
        ]:
            try:
                conn.execute(migration)
            except Exception:
                log.warning("Migration skipped (likely already applied): %s", migration[:30])
        conn.execute("""
            CREATE TABLE IF NOT EXISTS converter_migrations (
                key        TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
        """)
        cleanup_key = "clear_synthetic_qa_metrics_v1"
        cleanup_applied = conn.execute(
            "SELECT 1 FROM converter_migrations WHERE key = ?", (cleanup_key,)
        ).fetchone()
        if not cleanup_applied:
            # Every certification produced by older builds came from a simulated sleep.
            conn.execute(
                "UPDATE tools SET qa_avg_ms = NULL, qa_certified = 0 WHERE qa_certified = 1"
            )
            conn.execute(
                "INSERT INTO converter_migrations (key, applied_at) VALUES (?, ?)",
                (cleanup_key, datetime.now(UTC).isoformat()),
            )
        conn.commit()


# ── In-memory job store ───────────────────────────────────────────────────────

jobs: dict[str, dict] = {}  # job_id → {status, logs, result, error}
executor = ThreadPoolExecutor(max_workers=4)

# ── Code analysis helpers ─────────────────────────────────────────────────────


def _collect_files(root: Path) -> list[dict]:
    files = []
    for p in sorted(root.rglob("*")):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if not p.is_file() or p.suffix not in SUPPORTED_EXT:
            continue
        try:
            content = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        files.append({"path": str(p.relative_to(root)), "content": content})

    def priority(f: dict) -> int:
        p = f["path"].lower()
        if any(k in p for k in ("main", "app", "server", "index", "route", "api")):
            return 0
        if any(k in p for k in ("test", "spec", "config", "setup", "migration")):
            return 2
        return 1

    files.sort(key=lambda f: (priority(f), f["path"].count("/"), len(f["path"])))
    out = []
    for f in files[:MAX_FILES]:
        c = f["content"]
        if len(c) > MAX_FILE_BYTES:
            c = c[:MAX_FILE_BYTES] + "\n... (truncated)"
        out.append({"path": f["path"], "content": c})
    return out


def _build_tree(root: Path) -> str:
    lines = []
    for p in sorted(root.rglob("*")):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        indent = "  " * (len(p.relative_to(root).parts) - 1)
        lines.append(f"{indent}{p.name}{'/' if p.is_dir() else ''}")
    return "\n".join(lines[:100])


SYSTEM_PROMPT = """\
You are an expert software engineer. Analyze a GitHub repository and return a
JSON spec for exposing its capabilities as HTTP API endpoints.

Return ONLY valid JSON — no markdown, no prose.

Schema:
{
  "repo_name": "string",
  "language": "string",
  "description": "one-sentence description",
  "endpoints": [
    {
      "method": "POST" or "GET",
      "path": "/snake_case",
      "summary": "one-line description",
      "request_body": { "field": "type — description" },
      "response_example": { "field": "example value" }
    }
  ],
  "setup_notes": "required env vars or empty string"
}

Rules: 2–4 endpoints, only expose genuinely callable logic, paths start with /.
"""


def _extract_json(text: str) -> dict:
    text = re.sub(r"^```[a-z]*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text)
    # Find the outermost { ... } block
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object in response")
    # Walk to find matching closing brace
    depth, end = 0, -1
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end == -1:
        # LLM truncated mid-stream — take what we have and try to close it
        end = len(text)
    candidate = text[start:end]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        # Strip trailing commas, then try closing open braces/brackets
        cleaned = re.sub(r",(\s*[}\]])", r"\1", candidate)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            # Count unclosed depth and append closing chars
            stack = []
            in_str = False
            esc = False
            for ch in cleaned:
                if esc:
                    esc = False
                    continue
                if ch == "\\" and in_str:
                    esc = True
                    continue
                if ch == '"':
                    in_str = not in_str
                    continue
                if in_str:
                    continue
                if ch in "{[":
                    stack.append("}" if ch == "{" else "]")
                elif ch in "}]":
                    if stack:
                        stack.pop()
            if in_str:
                cleaned += '"'
            cleaned += "".join(reversed(stack))
            cleaned = re.sub(r",(\s*[}\]])", r"\1", cleaned)
            return json.loads(cleaned)


async def _generate_pdf_summary(spec: dict, slug: str, repo_url: str) -> str:
    """Generate a structured markdown summary for human review."""
    name = spec.get("repo_name", slug)
    language = spec.get("language", "unknown")
    description = spec.get("description", "")
    endpoints = spec.get("endpoints", [])
    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")

    ep_rows = "\n".join(
        f"| {ep.get('method', '?')} | `{ep.get('path', '?')}` | {ep.get('summary', '')[:80]} |"
        for ep in endpoints
    )
    ep_table = (
        f"| Method | Path | Summary |\n|--------|------|---------|\n{ep_rows}"
        if ep_rows
        else "_No endpoints detected_"
    )

    first_ep = endpoints[0] if endpoints else None
    input_fields = first_ep.get("request_body", {}) if first_ep else {}
    input_rows = "\n".join(f"| `{k}` | {v} |" for k, v in input_fields.items())
    input_table = (
        f"| Field | Type / Description |\n|-------|------------------|\n{input_rows}"
        if input_rows
        else "_No input schema_"
    )

    qa_line = "Not executed; deploy and test the real endpoint before approval"

    summary = f"""# API Review Summary — {name}

**Submitted:** {now} &nbsp;·&nbsp; **Language:** {language} &nbsp;·&nbsp; **QA:** {qa_line}

---

## Description

{description}

---

## Endpoints ({len(endpoints)} detected)

{ep_table}

---

## Input Schema

{input_table}

---

## Repository

{repo_url}

---

*Generated by Hackmarket AI · For internal review only*
"""
    return summary


async def _generate_qa_inputs(spec: dict) -> dict:
    """Use Groq to generate realistic, contextually accurate demo inputs for a tool."""
    if not GROQ_API_KEY:
        return {}
    endpoints = spec.get("endpoints", [])
    first_ep = endpoints[0] if endpoints else None
    if not first_ep or not first_ep.get("request_body"):
        return {}

    request_body = first_ep["request_body"]
    description = spec.get("description", "")
    name = spec.get("repo_name", "tool")

    prompt = (
        f"You are generating realistic demo inputs for an API tool.\n\n"
        f"Tool: {name}\nDescription: {description}\n"
        f"Input fields (name: type — description): {json.dumps(request_body)}\n\n"
        f"Return ONLY a JSON object mapping each field name to a realistic, contextually "
        f"appropriate string or number value. Make the values specific to what this tool "
        f"actually does — not generic placeholders. Return ONLY valid JSON, no markdown, "
        f"no prose."
    )

    def _call() -> dict:
        from groq import Groq

        client = Groq(api_key=GROQ_API_KEY)
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=512,
        )
        raw = resp.choices[0].message.content or "{}"
        return _extract_json(raw)

    try:
        return await asyncio.to_thread(_call)
    except Exception as e:
        log.warning("QA input generation failed (non-fatal): %s", e)
        return {}


def _call_groq(files: list[dict], tree: str) -> dict:
    from groq import Groq

    client = Groq(api_key=GROQ_API_KEY)
    files_text = "\n\n".join(f"=== {f['path']} ===\n{f['content']}" for f in files)
    resp = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"File tree:\n{tree}\n\nSource:\n{files_text}"},
        ],
        temperature=0,
        max_tokens=2048,
    )
    return _extract_json(resp.choices[0].message.content or "{}")


# ── Background analysis task ──────────────────────────────────────────────────


def _log(job_id: str, msg: str) -> None:
    jobs[job_id]["logs"].append(msg)
    log.info("[%s] %s", job_id, msg)


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "tool"
    # ensure uniqueness
    with get_conn() as conn:
        existing = {r[0] for r in conn.execute("SELECT slug FROM tools")}
    slug, n = base, 1
    while slug in existing:
        slug = f"{base}-{n}"
        n += 1
    return slug


def _register_with_main_api(spec: dict, repo_url: str) -> str:
    """POST the analyzed spec to the main API's internal import endpoint. Returns marketplace URL."""
    import urllib.request

    payload = json.dumps(
        {
            "repo_url": repo_url,
            "repo_name": spec.get("repo_name", "tool"),
            "language": spec.get("language", "unknown"),
            "description": spec.get("description", ""),
            "endpoints": spec.get("endpoints", []),
            "setup_notes": spec.get("setup_notes", ""),
        }
    ).encode()
    req = urllib.request.Request(
        f"{MAIN_API_URL.rstrip('/')}/v1/internal/tools/import",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Converter-Secret": CONVERTER_SECRET,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
    return result["marketplace_url"]


def _run_analysis(job_id: str, repo_url: str) -> None:
    """Blocking function — runs in thread executor."""
    job = jobs[job_id]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            _log(job_id, "Cloning repository...")
            r = subprocess.run(
                ["git", "clone", "--depth", "1", repo_url, tmp],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if r.returncode != 0:
                raise RuntimeError(f"Clone failed: {r.stderr.strip()[:200]}")

            _log(job_id, "Reading source files...")
            root = Path(tmp)
            files = _collect_files(root)
            tree = _build_tree(root)
            _log(job_id, f"{len(files)} file(s) selected for analysis")

            _log(job_id, "Detecting language and entry points...")
            _log(job_id, "Mapping callable functions...")
            _log(job_id, "Generating API schema with AI...")

            spec = _call_groq(files, tree)
            _log(job_id, "Schema generated.")

            _log(job_id, "Registering tool...")
            slug = _slugify(spec.get("repo_name", "tool"))
            tool_id = str(uuid.uuid4())
            now = datetime.now(UTC).isoformat()

            with get_conn() as conn:
                conn.execute(
                    "INSERT INTO tools (id, slug, repo_url, spec, created_at) VALUES (?,?,?,?,?)",
                    (tool_id, slug, repo_url, json.dumps(spec), now),
                )
                conn.commit()

            # Sync to main API if configured
            marketplace_url = None
            if CONVERTER_SECRET and MAIN_API_URL:
                try:
                    marketplace_url = _register_with_main_api(spec, repo_url)
                    _log(job_id, f"Listed on marketplace: {marketplace_url}")
                except Exception as e:
                    log.warning("Main API sync failed (non-fatal): %s", e)

            _log(job_id, "Done.")
            job["status"] = "done"
            job["result"] = {
                **spec,
                "slug": slug,
                "tool_id": tool_id,
                "marketplace_url": marketplace_url,
            }

    except Exception as exc:
        log.exception("Analysis failed for %s", job_id)
        job["status"] = "error"
        job["error"] = str(exc)


# ── SSE helpers ───────────────────────────────────────────────────────────────


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _stream(job_id: str) -> AsyncIterator[str]:
    last = 0
    while True:
        job = jobs.get(job_id)
        if job is None:
            yield _sse({"type": "error", "message": "job not found"})
            return

        logs = job.get("logs", [])
        for line in logs[last:]:
            yield _sse({"type": "log", "message": line})
        last = len(logs)

        if job["status"] == "done":
            yield _sse({"type": "done", "result": job["result"]})
            return
        if job["status"] == "error":
            yield _sse({"type": "error", "message": job.get("error", "unknown error")})
            return

        await asyncio.sleep(0.25)


# ── App ───────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    init_db()
    if not GROQ_API_KEY:
        log.warning("GROQ_API_KEY not set — analysis will fail")
    yield


app = FastAPI(title="Hackmarket Converter", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": GROQ_MODEL}


class AnalyzeRequest(BaseModel):
    repo_url: str


@app.post("/api/analyze", status_code=202)
async def start_analyze(body: AnalyzeRequest) -> dict:
    url = body.repo_url.strip().rstrip("/")
    if not re.match(r"https://github\.com/[^/]+/[^/]+", url):
        raise HTTPException(422, "Must be a valid https://github.com/owner/repo URL")

    if not GROQ_API_KEY:
        raise HTTPException(503, "GROQ_API_KEY not configured on the server")

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "logs": []}
    asyncio.get_running_loop().run_in_executor(executor, _run_analysis, job_id, url)
    return {"job_id": job_id}


@app.get("/api/analyze/{job_id}/stream")
async def stream_analyze(job_id: str) -> StreamingResponse:
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    return StreamingResponse(
        _stream(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/tools")
def list_tools(limit: int = 20, offset: int = 0, q: str = "", show_all: bool = False) -> dict:
    with get_conn() as conn:
        listed_clause = "" if show_all else "AND listed = 1"
        cols = "id, slug, repo_url, spec, created_at, listed, qa_inputs, qa_avg_ms, qa_certified, review_status"
        if q.strip():
            pattern = f"%{q.strip()}%"
            total = conn.execute(
                f"SELECT COUNT(*) FROM tools WHERE spec LIKE ? {listed_clause}", (pattern,)
            ).fetchone()[0]
            rows = conn.execute(
                f"SELECT {cols} FROM tools "
                f"WHERE spec LIKE ? {listed_clause} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (pattern, limit, offset),
            ).fetchall()
        else:
            total = conn.execute(
                f"SELECT COUNT(*) FROM tools WHERE 1=1 {listed_clause}"
            ).fetchone()[0]
            rows = conn.execute(
                f"SELECT {cols} FROM tools "
                f"WHERE 1=1 {listed_clause} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
    tools = []
    for r in rows:
        spec = json.loads(r["spec"])
        tools.append(
            {
                "id": r["id"],
                "slug": r["slug"],
                "repo_url": r["repo_url"],
                "name": spec.get("repo_name", r["slug"]),
                "language": spec.get("language", ""),
                "description": spec.get("description", ""),
                "endpoints": spec.get("endpoints", []),
                "setup_notes": spec.get("setup_notes", ""),
                "created_at": r["created_at"],
                "listed": bool(r["listed"]),
                "qa_inputs": json.loads(r["qa_inputs"]) if r["qa_inputs"] else None,
                "qa_avg_ms": r["qa_avg_ms"],
                "qa_certified": bool(r["qa_certified"]),
                "review_status": r["review_status"] or "draft",
            }
        )
    return {"tools": tools, "total": total}


@app.post("/api/tools/{slug}/qa")
async def qa_tool(slug: str) -> dict:
    """Generate candidate test inputs without claiming runtime certification."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT spec, qa_certified, qa_inputs, qa_avg_ms FROM tools WHERE slug = ?", (slug,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Tool not found")

    spec = json.loads(row["spec"])
    inputs = await _generate_qa_inputs(spec)

    with get_conn() as conn:
        conn.execute(
            "UPDATE tools SET qa_inputs = ?, qa_avg_ms = ?, qa_certified = ? WHERE slug = ?",
            (json.dumps(inputs), None, 0, slug),
        )
        conn.commit()

    return {
        "certified": False,
        "avg_ms": None,
        "inputs": inputs,
        "message": "Runtime QA requires a deployed tool endpoint.",
    }


@app.post("/api/tools/{slug}/list")
async def list_tool(slug: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, spec, repo_url, qa_avg_ms, qa_certified FROM tools WHERE slug = ?", (slug,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Tool not found")

    spec = json.loads(row["spec"])
    pdf = await _generate_pdf_summary(spec, slug, row["repo_url"])

    with get_conn() as conn:
        conn.execute(
            "UPDATE tools SET review_status = 'pending_review', pdf_summary = ? WHERE slug = ?",
            (pdf, slug),
        )
        conn.commit()
    return {"slug": slug, "review_status": "pending_review"}


@app.get("/api/tools/pending")
def list_pending_tools() -> dict:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, slug, repo_url, spec, created_at, qa_inputs, qa_avg_ms, qa_certified, pdf_summary "
            "FROM tools WHERE review_status = 'pending_review' ORDER BY created_at DESC"
        ).fetchall()
    tools = []
    for r in rows:
        spec = json.loads(r["spec"])
        tools.append(
            {
                "id": r["id"],
                "slug": r["slug"],
                "repo_url": r["repo_url"],
                "name": spec.get("repo_name", r["slug"]),
                "language": spec.get("language", ""),
                "description": spec.get("description", ""),
                "endpoints": spec.get("endpoints", []),
                "qa_certified": bool(r["qa_certified"]),
                "qa_avg_ms": r["qa_avg_ms"],
                "pdf_summary": r["pdf_summary"],
                "created_at": r["created_at"],
            }
        )
    return {"tools": tools, "total": len(tools)}


@app.post("/api/tools/{slug}/approve")
def approve_tool(slug: str) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM tools WHERE slug = ?", (slug,)).fetchone()
        if not row:
            raise HTTPException(404, "Tool not found")
    raise HTTPException(
        409,
        "Converter analysis cannot approve a tool without a deployed endpoint. Submit it through the seller pipeline.",
    )


class RejectRequest(BaseModel):
    notes: str = ""


@app.post("/api/tools/{slug}/reject")
def reject_tool(slug: str, body: RejectRequest) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM tools WHERE slug = ?", (slug,)).fetchone()
        if not row:
            raise HTTPException(404, "Tool not found")
        conn.execute(
            "UPDATE tools SET review_status = 'rejected', reviewer_notes = ? WHERE slug = ?",
            (body.notes, slug),
        )
        conn.commit()
    return {"slug": slug, "rejected": True}


@app.post("/api/tools/{slug}/demo")
async def demo_tool(slug: str) -> dict:
    """Reject synthetic previews; demos require a deployed tool endpoint."""
    with get_conn() as conn:
        row = conn.execute("SELECT spec FROM tools WHERE slug = ?", (slug,)).fetchone()
    if not row:
        raise HTTPException(404, "Tool not found")

    raise HTTPException(
        501,
        "A live demo is unavailable until this tool has a deployed endpoint.",
    )


@app.get("/api/tools/{slug}")
def get_tool(slug: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, slug, repo_url, spec, created_at, qa_inputs, qa_avg_ms, qa_certified, review_status "
            "FROM tools WHERE slug = ?",
            (slug,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Tool not found")
    spec = json.loads(row["spec"])
    return {
        "id": row["id"],
        "slug": row["slug"],
        "repo_url": row["repo_url"],
        "created_at": row["created_at"],
        "qa_inputs": json.loads(row["qa_inputs"]) if row["qa_inputs"] else None,
        "qa_avg_ms": row["qa_avg_ms"],
        "qa_certified": bool(row["qa_certified"]),
        "review_status": row["review_status"] or "draft",
        "name": spec.get("repo_name", row["slug"]),
        **spec,
    }
