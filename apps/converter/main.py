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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("converter")

# ── Config ────────────────────────────────────────────────────────────────────

GROQ_API_KEY   = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL     = "llama-3.1-8b-instant"
DB_PATH        = os.environ.get("DB_PATH", "tools.db")
MAX_FILE_BYTES = 3_000
MAX_FILES      = 6

SUPPORTED_EXT = {
    ".py", ".js", ".ts", ".go", ".rs", ".rb", ".java", ".cpp", ".c",
}

SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", "venv", ".venv",
    "dist", "build", ".next", "vendor", "target",
}

# ── Database ──────────────────────────────────────────────────────────────────

def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tools (
                id         TEXT PRIMARY KEY,
                slug       TEXT UNIQUE NOT NULL,
                repo_url   TEXT NOT NULL,
                spec       TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.commit()


# ── In-memory job store ───────────────────────────────────────────────────────

jobs: dict[str, dict] = {}          # job_id → {status, logs, result, error}
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
    m = re.search(r"\{[\s\S]+\}", text)
    if m:
        return json.loads(m.group())
    raise ValueError("No JSON in response")


def _call_groq(files: list[dict], tree: str) -> dict:
    from groq import Groq
    client = Groq(api_key=GROQ_API_KEY)
    files_text = "\n\n".join(f"=== {f['path']} ===\n{f['content']}" for f in files)
    resp = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": f"File tree:\n{tree}\n\nSource:\n{files_text}"},
        ],
        temperature=0,
        max_tokens=1400,
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


def _run_analysis(job_id: str, repo_url: str) -> None:
    """Blocking function — runs in thread executor."""
    job = jobs[job_id]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            _log(job_id, "Cloning repository...")
            r = subprocess.run(
                ["git", "clone", "--depth", "1", repo_url, tmp],
                capture_output=True, text=True, timeout=60,
            )
            if r.returncode != 0:
                raise RuntimeError(f"Clone failed: {r.stderr.strip()[:200]}")

            _log(job_id, "Reading source files...")
            root  = Path(tmp)
            files = _collect_files(root)
            tree  = _build_tree(root)
            _log(job_id, f"{len(files)} file(s) selected for analysis")

            _log(job_id, "Detecting language and entry points...")
            _log(job_id, "Mapping callable functions...")
            _log(job_id, "Generating API schema with AI...")

            spec = _call_groq(files, tree)
            _log(job_id, "Schema generated.")

            _log(job_id, "Registering tool...")
            slug = _slugify(spec.get("repo_name", "tool"))
            tool_id = str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat()

            with get_conn() as conn:
                conn.execute(
                    "INSERT INTO tools (id, slug, repo_url, spec, created_at) VALUES (?,?,?,?,?)",
                    (tool_id, slug, repo_url, json.dumps(spec), now),
                )
                conn.commit()

            _log(job_id, "Done.")
            job["status"] = "done"
            job["result"] = {**spec, "slug": slug, "tool_id": tool_id}

    except Exception as exc:
        log.exception("Analysis failed for %s", job_id)
        job["status"]  = "error"
        job["error"]   = str(exc)


# ── SSE helpers ───────────────────────────────────────────────────────────────

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _stream(job_id: str) -> AsyncIterator[str]:
    last = 0
    while True:
        job  = jobs.get(job_id)
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

app = FastAPI(title="Hackmarket Converter", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()
    if not GROQ_API_KEY:
        log.warning("GROQ_API_KEY not set — analysis will fail")


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
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _run_analysis, job_id, url)
    return {"job_id": job_id}


@app.get("/api/analyze/{job_id}/stream")
async def stream_analyze(job_id: str) -> StreamingResponse:
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    return StreamingResponse(
        _stream(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/tools")
def list_tools(limit: int = 20, offset: int = 0) -> dict:
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) FROM tools").fetchone()[0]
        rows  = conn.execute(
            "SELECT id, slug, repo_url, spec, created_at FROM tools ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    tools = []
    for r in rows:
        spec = json.loads(r["spec"])
        tools.append({
            "id":          r["id"],
            "slug":        r["slug"],
            "repo_url":    r["repo_url"],
            "name":        spec.get("repo_name", r["slug"]),
            "language":    spec.get("language", ""),
            "description": spec.get("description", ""),
            "endpoints":   spec.get("endpoints", []),
            "setup_notes": spec.get("setup_notes", ""),
            "created_at":  r["created_at"],
        })
    return {"tools": tools, "total": total}


@app.get("/api/tools/{slug}")
def get_tool(slug: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, slug, repo_url, spec, created_at FROM tools WHERE slug = ?", (slug,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Tool not found")
    spec = json.loads(row["spec"])
    return {
        "id":          row["id"],
        "slug":        row["slug"],
        "repo_url":    row["repo_url"],
        "created_at":  row["created_at"],
        **spec,
    }
