"""Server-side keyword-weighted tool discovery.

Transliterated from kc:backend/src/routes/discover.ts so the marketplace
no longer has to do client-side scoring.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.tool import Tool, ToolCategory, ToolStatus

STOP_WORDS: frozenset[str] = frozenset(
    {
        "a",
        "an",
        "the",
        "for",
        "to",
        "of",
        "in",
        "on",
        "at",
        "with",
        "and",
        "or",
        "but",
        "is",
        "are",
        "do",
        "does",
        "did",
        "i",
        "we",
        "you",
        "my",
        "our",
        "your",
        "it",
        "its",
        "that",
        "this",
        "from",
        "have",
        "has",
        "had",
        "want",
        "need",
        "how",
        "can",
        "could",
        "should",
        "would",
        "will",
        "app",
        "project",
        "build",
        "using",
        "use",
        "make",
        "get",
    }
)


def tokenize(query: str) -> list[str]:
    """Lowercase, split on non-alphanumerics, drop short tokens and stop-words."""
    raw = "".join(c.lower() if c.isalnum() else " " for c in query).split()
    return [tok for tok in raw if len(tok) > 1 and tok not in STOP_WORDS]


@dataclass(frozen=True)
class _Hay:
    text: str
    weight: float


def _tool_haystacks(tool: Tool) -> list[_Hay]:
    """Build the weighted text bags used for keyword scoring."""

    def _field_text(value: dict | list | str | None) -> str:
        if not value:
            return ""
        if isinstance(value, str):
            return value
        try:
            return json.dumps(value)
        except (TypeError, ValueError):
            return str(value)

    tech_terms: list[str] = []
    if isinstance(tool.input_schema, dict):
        fields = tool.input_schema.get("fields")
        if isinstance(fields, list):
            for f in fields:
                if isinstance(f, dict) and isinstance(f.get("name"), str):
                    tech_terms.append(f["name"])

    return [
        _Hay((tool.name or "").lower(), 3.0),
        _Hay((tool.tagline or "").lower(), 2.5),
        _Hay((tool.description or "").lower(), 2.0),
        _Hay((tool.category.value if tool.category else "").lower(), 2.0),
        _Hay(" ".join(tech_terms).lower(), 2.0),
        _Hay(_field_text(tool.input_schema).lower(), 1.0),
        _Hay(_field_text(tool.output_schema).lower(), 1.0),
    ]


def score_tool(tokens: list[str], tool: Tool) -> tuple[float, list[str]]:
    if not tokens:
        return 0.0, []
    haystacks = _tool_haystacks(tool)
    score = 0.0
    matched: set[str] = set()
    for tok in tokens:
        for hay in haystacks:
            if tok in hay.text:
                score += hay.weight
                matched.add(tok)
    return score, sorted(matched)


def fit_line(query: str, matched: list[str], tool: Tool) -> str:
    """Generate the contextual one-liner shown on each result card."""
    if not matched:
        desc = tool.tagline or tool.description or tool.name
        return f"Could help with what you're describing: {desc[:120]}"
    top = ", ".join(matched[:3])
    trimmed = query if len(query) <= 50 else f"{query[:47]}..."
    return f'Matches "{trimmed}" via {top}.'


async def discover_tools(
    db: AsyncSession,
    query: str,
    categories: list[ToolCategory] | None,
    limit: int,
) -> list[tuple[Tool, float, list[str], str]]:
    """Return ranked (tool, score, matched_keywords, fit_line) tuples."""
    tokens = tokenize(query)

    stmt = select(Tool).where(Tool.status == ToolStatus.live).options(selectinload(Tool.seller))
    if categories:
        stmt = stmt.where(Tool.category.in_(categories))

    result = await db.execute(stmt)
    rows = list(result.scalars())

    ranked: list[tuple[Tool, float, list[str]]] = []
    for tool in rows:
        if tokens:
            score, matched = score_tool(tokens, tool)
        else:
            score, matched = 0.0, []
        ranked.append((tool, score, matched))

    if tokens:
        filtered = [r for r in ranked if r[1] > 0]
        filtered.sort(key=lambda r: r[1], reverse=True)
    else:
        filtered = sorted(ranked, key=lambda r: r[0].total_requests or 0, reverse=True)

    out: list[tuple[Tool, float, list[str], str]] = []
    for tool, score, matched in filtered[:limit]:
        out.append((tool, score, matched, fit_line(query, matched, tool)))
    return out
