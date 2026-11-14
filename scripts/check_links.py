#!/usr/bin/env python3
"""Check that relative links in Markdown files point at files/dirs that exist.

Usage: python scripts/check_links.py   (exit code 1 on broken links)
Stack-agnostic on purpose: it runs before any project stack is chosen.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
SKIP_DIRS = {".git", "node_modules", ".venv", "venv"}


def main() -> int:
    broken = []
    files = [p for p in ROOT.rglob("*.md") if not SKIP_DIRS & set(p.relative_to(ROOT).parts)]
    for md in files:
        text = md.read_text(encoding="utf-8")
        # ignore fenced code blocks
        text = re.sub(r"```.*?```", "", text, flags=re.S)
        for target in LINK.findall(text):
            if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
                continue  # external URL, mailto, or in-page anchor
            path = target.split("#", 1)[0]
            if not path:
                continue
            resolved = (md.parent / path).resolve()
            if not resolved.exists():
                broken.append(f"{md.relative_to(ROOT)} -> {target}")
    for b in broken:
        print(f"BROKEN: {b}")
    print(f"Checked {len(files)} Markdown files, {len(broken)} broken links.")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
