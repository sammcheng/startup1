#!/usr/bin/env python3
"""Statically flag risky Alembic upgrade operations before release.

The goal is not to ban destructive schema work forever. It is to force explicit
review before a migration can drop data, rename objects, or run raw destructive
SQL during a production launch.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = REPO_ROOT / "apps" / "api" / "alembic" / "versions"
REVIEW_MARKER = "MIGRATION_SAFETY_REVIEWED = True"

RISKY_OP_CALLS = {
    "drop_column",
    "drop_constraint",
    "drop_table",
    "rename_table",
}

RAW_SQL_RISK_WORDS = (
    " alter ",
    " delete ",
    " drop ",
    " truncate ",
)


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    message: str


def upgrade_function(tree: ast.AST) -> ast.FunctionDef | None:
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "upgrade":
            return node
    return None


def dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return None


def literal_text(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def migration_is_reviewed(source: str) -> bool:
    return REVIEW_MARKER in source


def inspect_call(path: Path, call: ast.Call) -> Finding | None:
    name = dotted_name(call.func)
    short_name = name.rsplit(".", 1)[-1] if name else ""
    if short_name in RISKY_OP_CALLS:
        return Finding(
            path,
            call.lineno,
            f"upgrade() calls op.{short_name}; add {REVIEW_MARKER!r} after backup/rollback review",
        )

    if short_name != "execute":
        return None

    for arg in call.args:
        text = literal_text(arg)
        if (
            text is None
            and isinstance(arg, ast.Call)
            and dotted_name(arg.func) in {"sa.text", "sqlalchemy.text"}
        ):
            text = literal_text(arg.args[0]) if arg.args else None
        if text is None:
            continue
        normalized = f" {text.lower()} "
        if any(word in normalized for word in RAW_SQL_RISK_WORDS):
            return Finding(
                path,
                call.lineno,
                f"upgrade() executes potentially destructive SQL; add {REVIEW_MARKER!r} after review",
            )
    return None


def inspect_migration(path: Path) -> list[Finding]:
    source = path.read_text(encoding="utf-8")
    if migration_is_reviewed(source):
        return []

    tree = ast.parse(source, filename=str(path))
    upgrade = upgrade_function(tree)
    if upgrade is None:
        return [Finding(path, 1, "migration is missing upgrade()")]

    findings: list[Finding] = []
    for node in ast.walk(upgrade):
        if isinstance(node, ast.Call):
            finding = inspect_call(path, node)
            if finding:
                findings.append(finding)
    return findings


def main() -> int:
    findings: list[Finding] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.py")):
        findings.extend(inspect_migration(path))

    if findings:
        print("Migration safety check failed. Review these risky upgrade operations:")
        for finding in findings:
            relative = finding.path.relative_to(REPO_ROOT)
            print(f"- {relative}:{finding.line}: {finding.message}")
        return 1

    print("Migration safety check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
