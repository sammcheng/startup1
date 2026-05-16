#!/usr/bin/env python3
"""
Standalone GitHub → API analyzer using Groq.
Usage: python analyze.py <github_url> [--groq-key gsk_...]
       GROQ_API_KEY=gsk_... python analyze.py <github_url>
No database or Docker needed.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

GROQ_MODEL = "llama-3.1-8b-instant"  # 20k TPM on free tier

SUPPORTED_EXTENSIONS = {
    ".py", ".js", ".ts", ".go", ".rs", ".rb", ".java", ".cpp", ".c",
}
MAX_FILE_BYTES = 3_000   # keep each file small
MAX_FILES = 6            # only the most relevant files


# ── Step 1: Clone ─────────────────────────────────────────────────────────────

def clone_repo(url: str, dest: str) -> None:
    print(f"  Cloning {url} ...")
    result = subprocess.run(
        ["git", "clone", "--depth", "1", url, dest],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr.strip()}")
        sys.exit(1)
    print("  Done.")


# ── Step 2: Build file context ────────────────────────────────────────────────

def collect_files(root: Path) -> list[dict]:
    skip_dirs = {"node_modules", ".git", "__pycache__", "venv", ".venv",
                 "dist", "build", ".next", "vendor", "target"}
    files = []
    for p in sorted(root.rglob("*")):
        if any(part in skip_dirs for part in p.parts):
            continue
        if not p.is_file() or p.suffix not in SUPPORTED_EXTENSIONS:
            continue
        try:
            content = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        files.append({"path": str(p.relative_to(root)), "content": content})

    # Prioritise entry points and route files, deprioritise tests/configs
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
        content = f["content"]
        if len(content) > MAX_FILE_BYTES:
            content = content[:MAX_FILE_BYTES] + "\n... (truncated)"
        out.append({"path": f["path"], "content": content})
    return out


def build_file_tree(root: Path) -> str:
    skip_dirs = {"node_modules", ".git", "__pycache__", "venv", ".venv",
                 "dist", "build", ".next", "vendor", "target"}
    lines = []
    for p in sorted(root.rglob("*")):
        if any(part in skip_dirs for part in p.parts):
            continue
        indent = "  " * (len(p.relative_to(root).parts) - 1)
        lines.append(f"{indent}{p.name}{'/' if p.is_dir() else ''}")
    return "\n".join(lines[:120])


# ── Step 3: Call Groq ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are an expert software engineer. Analyze a GitHub repository and return a
JSON spec for exposing its core capabilities as HTTP API endpoints.

Return ONLY a valid JSON object — no markdown fences, no explanation, just JSON.

Schema:
{
  "repo_name": "string",
  "language": "string",
  "description": "one-sentence description",
  "endpoints": [
    {
      "method": "POST" or "GET",
      "path": "/snake_case_path",
      "summary": "one-line description of what this endpoint does",
      "request_body": { "field_name": "type — description" },
      "response_example": { "field_name": "example value" }
    }
  ],
  "setup_notes": "env vars or secrets required, or empty string"
}

Rules:
- 2–4 endpoints max. Only expose logic that is genuinely callable externally.
- POST for operations that take input. GET for read-only queries.
- Every path must start with /.
- If no callable logic exists, return an empty endpoints array.
"""


def extract_json(text: str) -> dict:
    """Pull the first {...} block out of a response that may contain prose."""
    text = text.strip()
    # Strip markdown fences if present
    text = re.sub(r"^```[a-z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    # Find first complete JSON object
    match = re.search(r"\{[\s\S]+\}", text)
    if match:
        return json.loads(match.group())
    raise ValueError(f"No JSON object found in response:\n{text[:300]}")


def analyze_with_groq(files: list[dict], file_tree: str, api_key: str) -> dict:
    try:
        from groq import Groq
    except ImportError:
        print("  groq package not installed. Run: pip install groq")
        sys.exit(1)

    client = Groq(api_key=api_key)

    files_text = "\n\n".join(f"=== {f['path']} ===\n{f['content']}" for f in files)
    user_message = f"File tree:\n{file_tree}\n\nSource files:\n{files_text}"

    print(f"  Calling Groq ({GROQ_MODEL}) ...")
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": user_message},
        ],
        temperature=0,
        max_tokens=1500,
    )

    raw = response.choices[0].message.content or "{}"
    return extract_json(raw)


# ── Step 4: Print results ─────────────────────────────────────────────────────

def print_results(result: dict) -> None:
    slug = re.sub(r"[^a-z0-9]+", "-", result.get("repo_name", "my-tool").lower()).strip("-")
    base = f"https://api.hackmarket.io/v1/tools/{slug}"

    print("\n" + "─" * 64)
    print(f"  Repo     : {result.get('repo_name', '?')}")
    print(f"  Language : {result.get('language', '?')}")
    print(f"  Summary  : {result.get('description', '')}")
    print("─" * 64)

    endpoints = result.get("endpoints", [])
    if not endpoints:
        print("  No callable endpoints detected.")
    else:
        print(f"  {len(endpoints)} endpoint(s) found:\n")
        for ep in endpoints:
            method = ep.get("method", "POST")
            path   = ep.get("path", "/run")
            print(f"  {method:<5} {base}{path}")
            print(f"        {ep.get('summary', '')}")
            body = ep.get("request_body", {})
            if body:
                print("        Input:")
                for field, desc in body.items():
                    print(f"          {field}: {desc}")
            resp = ep.get("response_example", {})
            if resp:
                print(f"        Output: {json.dumps(resp)}")
            print()

    notes = result.get("setup_notes", "")
    if notes:
        print(f"  Notes    : {notes}")

    print("─" * 64)
    print("\n  Full JSON output:\n")
    print(json.dumps(result, indent=2))


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze a GitHub repo and generate an API spec using Groq"
    )
    parser.add_argument("repo_url", help="e.g. https://github.com/user/repo")
    parser.add_argument(
        "--groq-key",
        default=os.environ.get("GROQ_API_KEY", ""),
        help="Groq API key (or set GROQ_API_KEY env var)",
    )
    args = parser.parse_args()

    if not args.groq_key:
        print("Error: provide your Groq key via --groq-key or GROQ_API_KEY env var")
        print("Get one free at: https://console.groq.com/keys")
        sys.exit(1)

    print(f"\nAnalyzing: {args.repo_url}")

    with tempfile.TemporaryDirectory() as tmp:
        print("\n[1/3] Cloning repo...")
        clone_repo(args.repo_url, tmp)

        print("\n[2/3] Reading source files...")
        root  = Path(tmp)
        files = collect_files(root)
        tree  = build_file_tree(root)
        print(f"  {len(files)} file(s) selected for analysis")

        print("\n[3/3] Analyzing with AI...")
        result = analyze_with_groq(files, tree, args.groq_key)

    print_results(result)


if __name__ == "__main__":
    main()
