#!/usr/bin/env python3
"""
Sync manual HTML fragment -> index.html + README.md.

Single source of truth: tools/_manual_fragment.html
  - Edit the fragment when changing 特記事項 / 使い方 / 改変・再利用 / ライセンス.
  - Run: python tools/sync-docs.py
  - Changelog in README comes from js/version.js (same as the app UI).

Optional:
  python tools/sync-docs.py --check        # exit 1 if outputs would change (CI)
  python tools/sync-docs.py --extract      # copy manual block from index.html into fragment
  python tools/sync-docs.py --init-markers # add markers to index.html (once)
"""
from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRAGMENT = ROOT / "tools" / "_manual_fragment.html"
INDEX = ROOT / "index.html"
VERSION_JS = ROOT / "js" / "version.js"
README = ROOT / "README.md"

MARKER_START = "<!-- @manual-doc:start -->"
MARKER_END = "<!-- @manual-doc:end -->"

GITHUB_PAGES_URL = "https://mga-ueda.github.io/MGA-CineAudio-Reviewer/"

# README 上では相対リンクが GitHub blob 表示になるため、ドキュメント HTML だけ Pages URL に差し替える
README_DOC_PAGES = {
    "guide.html": GITHUB_PAGES_URL + "guide.html",
    "shortcuts.html": GITHUB_PAGES_URL + "shortcuts.html",
}

MANUAL_BLOCK_RE = re.compile(
    r"\n\s*<details class=\"app-doc-fold\">"
    r"\s*\n\s*<summary[^>]*id=\"app-manual-notice-heading\".*?"
    r"</details>"
    r".*?"
    r"\n\s*<details class=\"app-doc-fold\">"
    r"\s*\n\s*<summary[^>]*id=\"app-manual-version-heading\".*?"
    r"</details>\s*\n",
    re.DOTALL,
)

README_INTRO = """# MGA CineAudio Reviewer

ブラウザ内だけで、動画と追加音声（最大 16 本）を同期再生し、波形・スペクトラム・マーカー付きコメントでレビュー共有ができるウェブアプリです。MA・劇伴・音楽など、映像と音声をタイムライン上で聴き比べながら修正指示をやり取りする用途向けです。

**[▶ オンラインで使う（GitHub Pages）]({pages_url})**

| | |
|---|---|
| **GitHub Pages** | [{pages_url}]({pages_url}) — ダウンロード不要ですぐに利用できます |
| **バージョン** | {version_label} |
| **ローカル起動** | リポジトリの `index.html` をブラウザで開く（ビルド不要・`file://` 可） |
| **推奨ブラウザ** | Google Chrome |
| **リポジトリ** | [mga-ueda/MGA-CineAudio-Reviewer](https://github.com/mga-ueda/MGA-CineAudio-Reviewer) |
| **ライセンス** | MIT License（全文は [LICENSE](LICENSE)） |

"""


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def parse_version_meta(version_js: str) -> tuple[str, list[dict]]:
    ver_m = re.search(r"const\s+APP_VERSION\s*=\s*'([^']+)'", version_js)
    if not ver_m:
        raise SystemExit("Could not parse APP_VERSION in js/version.js")
    version_label = "v" + ver_m.group(1)

    block_m = re.search(r"const\s+APP_CHANGELOG\s*=\s*\[(.*)\]\s*;", version_js, re.DOTALL)
    if not block_m:
        raise SystemExit("Could not parse APP_CHANGELOG in js/version.js")

    entries: list[dict] = []
    for em in re.finditer(
        r"\{\s*version:\s*'([^']+)',\s*date:\s*'([^']+)',\s*items:\s*\[(.*?)\]\s*,?\s*\}",
        block_m.group(1),
        re.DOTALL,
    ):
        items = [
            i.replace("\\'", "'")
            for i in re.findall(r"'((?:\\'|[^'])*)'", em.group(3), re.DOTALL)
        ]
        entries.append({"version": em.group(1), "date": em.group(2), "items": items})
    return version_label, entries


def changelog_to_markdown(entries: list[dict]) -> str:
    lines = ["## バージョン情報", ""]
    for entry in entries:
        lines.append(f"### v{entry['version']} - {entry['date']}")
        lines.append("")
        for item in entry["items"]:
            lines.append(f"- {item}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def inline_html_to_md(text: str, *, for_readme: bool = False) -> str:
    text = re.sub(r"<strong>(.*?)</strong>", r"**\1**", text, flags=re.DOTALL)
    text = re.sub(r"<code>(.*?)</code>", r"`\1`", text, flags=re.DOTALL)
    text = re.sub(r"<kbd>(.*?)</kbd>", r"`\1`", text, flags=re.DOTALL)

    def link_repl(m: re.Match[str]) -> str:
        href = m.group(1)
        if for_readme:
            href = README_DOC_PAGES.get(href, href)
        return f"[{m.group(2)}]({href})"

    text = re.sub(
        r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>',
        link_repl,
        text,
        flags=re.DOTALL,
    )
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(re.sub(r"\s+", " ", text)).strip()


def block_html_to_md(block: str, *, for_readme: bool = False) -> list[str]:
    out: list[str] = []
    pos = 0
    while pos < len(block):
        sec_m = re.search(
            r"<section[^>]*>\s*<h4[^>]*>(.*?)</h4>\s*(.*?)</section>",
            block[pos:],
            re.DOTALL,
        )
        if sec_m:
            out.append(f"### {inline_html_to_md(sec_m.group(1), for_readme=for_readme)}")
            out.append("")
            out.extend(block_html_to_md(sec_m.group(2), for_readme=for_readme))
            pos += sec_m.end()
            continue

        ul_m = re.match(r"\s*<ul>\s*(.*?)\s*</ul>", block[pos:], re.DOTALL)
        if ul_m:
            for li_m in re.finditer(r"<li>\s*(.*?)\s*</li>", ul_m.group(1), re.DOTALL):
                out.append(f"- {inline_html_to_md(li_m.group(1), for_readme=for_readme)}")
            out.append("")
            pos += ul_m.end()
            continue

        ol_m = re.match(r"\s*<ol>\s*(.*?)\s*</ol>", block[pos:], re.DOTALL)
        if ol_m:
            n = 1
            for li_m in re.finditer(r"<li>\s*(.*?)\s*</li>", ol_m.group(1), re.DOTALL):
                out.append(f"{n}. {inline_html_to_md(li_m.group(1), for_readme=for_readme)}")
                n += 1
            out.append("")
            pos += ol_m.end()
            continue

        break
    return out


def details_body_html(body: str) -> str:
    inner_m = re.search(
        r'<div class="app-doc-fold__body app-manual">(.*)</div>\s*$',
        body.strip(),
        re.DOTALL,
    )
    return inner_m.group(1).strip() if inner_m else body.strip()


def fragment_to_markdown(fragment: str, *, for_readme: bool = False) -> str:
    lines: list[str] = []
    for dm in re.finditer(
        r"<details[^>]*>.*?<summary[^>]*>(.*?)</summary>(.*?)</details>",
        fragment,
        re.DOTALL,
    ):
        if "app-manual-version-heading" in dm.group(0):
            continue

        summary = inline_html_to_md(dm.group(1), for_readme=for_readme)
        body = details_body_html(dm.group(2))

        lines.append(f"## {summary}")
        lines.append("")
        lines.extend(block_html_to_md(body, for_readme=for_readme))

    return "\n".join(lines).rstrip() + "\n"


def github_slug(title: str) -> str:
    """GitHub README 見出しアンカー用（github-slugger に近い簡易版）。"""
    t = html.unescape(title).strip().lower()
    t = re.sub(r"[\s_]+", "-", t)
    t = re.sub(r"[^\w\-]", "", t, flags=re.UNICODE)
    t = re.sub(r"-+", "-", t).strip("-")
    return t


def build_readme_toc(fragment_md: str) -> str:
    """README 専用の目次（## 大項目 + 使い方内 ### のみ階層化）。"""
    lines = ["## 目次", ""]
    in_usage = False
    for line in fragment_md.splitlines():
        if line.startswith("## "):
            title = line[3:].strip()
            in_usage = title == "使い方"
            lines.append(f"- [{title}](#{github_slug(title)})")
        elif line.startswith("### ") and in_usage:
            sub = line[4:].strip()
            lines.append(f"  - [{sub}](#{github_slug(sub)})")
    lines.append(f"- [バージョン情報](#{github_slug('バージョン情報')})")
    lines.append("")
    return "\n".join(lines)


def build_readme(fragment: str, version_label: str, changelog_md: str) -> str:
    fragment_md = fragment_to_markdown(fragment, for_readme=True)
    toc_md = build_readme_toc(fragment_md)
    return (
        README_INTRO.format(version_label=version_label, pages_url=GITHUB_PAGES_URL)
        + toc_md
        + "\n---\n\n"
        + fragment_md
        + "\n"
        + changelog_md
        + "\n"
        + "<!-- Generated by tools/sync-docs.py — do not edit manually. -->\n"
    )


def inject_index(index_text: str, fragment: str) -> str:
    if MARKER_START not in index_text or MARKER_END not in index_text:
        raise SystemExit(
            f"index.html must contain {MARKER_START} and {MARKER_END}. "
            "Run: python tools/sync-docs.py --init-markers"
        )
    start = index_text.index(MARKER_START) + len(MARKER_START)
    end = index_text.index(MARKER_END)
    frag = "\n" + fragment.strip("\n") + "\n"
    return index_text[:start] + frag + "\n" + index_text[end:]


def extract_manual_from_index(index_text: str) -> str:
    if MARKER_START in index_text and MARKER_END in index_text:
        chunk = index_text[index_text.index(MARKER_START) + len(MARKER_START) : index_text.index(MARKER_END)]
        return chunk.strip("\n") + "\n"
    m = MANUAL_BLOCK_RE.search(index_text)
    if not m:
        raise SystemExit("Could not find manual block in index.html (notice … version details)")
    return m.group(0).strip("\n") + "\n"


def init_markers(index_text: str, fragment: str) -> str:
    if MARKER_START in index_text:
        return index_text
    footer_m = re.search(r"\n(\s*<footer class=\"app-site-footer\">)", index_text)
    if not footer_m:
        raise SystemExit("Could not find footer in index.html")
    insert_at = footer_m.start()
    before = index_text[:insert_at]
    after = index_text[insert_at:]
    before = MANUAL_BLOCK_RE.sub("\n", before, count=1)
    block = f"\n{MARKER_START}\n{fragment.strip()}\n{MARKER_END}\n"
    return before.rstrip() + block + "\n" + after.lstrip("\n")


def repair_duplicate_manual_in_index(index_text: str) -> str:
    """Remove a manual block that appears before @manual-doc markers (one-time fix)."""
    if MARKER_START not in index_text:
        return index_text
    before, rest = index_text.split(MARKER_START, 1)
    before_clean, n = MANUAL_BLOCK_RE.subn("\n\n", before)
    if n:
        print(f"removed {n} duplicate manual block(s) before {MARKER_START}")
    return before_clean + MARKER_START + rest


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync manual fragment to index.html and README.md")
    parser.add_argument("--check", action="store_true", help="Exit 1 if outputs would change")
    parser.add_argument("--extract", action="store_true", help="Write index manual block into fragment")
    parser.add_argument("--init-markers", action="store_true", help="Add markers to index.html (once)")
    parser.add_argument("--repair-index", action="store_true", help="Remove duplicate manual before markers")
    args = parser.parse_args()

    index_text = read_text(INDEX)
    version_label, changelog_entries = parse_version_meta(read_text(VERSION_JS))
    changelog_md = changelog_to_markdown(changelog_entries)

    if args.repair_index:
        repaired = repair_duplicate_manual_in_index(index_text)
        if repaired != index_text:
            write_text(INDEX, repaired)
            print(f"wrote {INDEX.relative_to(ROOT)} (repaired)")
        else:
            print("no duplicate manual block found")
        return 0

    if args.extract:
        frag = extract_manual_from_index(index_text)
        write_text(FRAGMENT, frag)
        print(f"wrote {FRAGMENT.relative_to(ROOT)} ({len(frag.splitlines())} lines)")
        return 0

    if args.init_markers:
        if not FRAGMENT.exists():
            write_text(FRAGMENT, extract_manual_from_index(index_text))
        fragment = read_text(FRAGMENT)
        write_text(INDEX, init_markers(index_text, fragment))
        print("initialized markers in index.html")
        index_text = read_text(INDEX)

    if not FRAGMENT.exists():
        raise SystemExit(f"{FRAGMENT} not found. Run: python tools/sync-docs.py --extract")

    fragment = read_text(FRAGMENT)
    new_readme = build_readme(fragment, version_label, changelog_md)
    new_index = inject_index(index_text, fragment)

    if args.check:
        ok = README.exists() and read_text(README) == new_readme and index_text == new_index
        if ok:
            print("sync-docs: OK (up to date)")
            return 0
        if not README.exists() or read_text(README) != new_readme:
            print("sync-docs: README.md is out of date", file=sys.stderr)
        if index_text != new_index:
            print("sync-docs: index.html manual block is out of date", file=sys.stderr)
        return 1

    write_text(README, new_readme)
    write_text(INDEX, new_index)
    print(f"wrote {README.relative_to(ROOT)}")
    print(f"wrote {INDEX.relative_to(ROOT)} (manual block)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
