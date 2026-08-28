#!/usr/bin/env python3
"""Replace 1-arg formatCurrency calls with company money() on dashboard pages."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {
    ROOT / "src/app/(dashboard)/invoices/[id]/view/page.tsx",
    ROOT / "src/app/(dashboard)/dashboard/page.tsx",
    ROOT / "src/app/portal/page.tsx",
}

HOOK_IMPORT = "import { useCompanyMoney } from '@/hooks/use-company-money';"


def top_level_arg_count(inner: str) -> int:
    depth = 0
    args = 1 if inner.strip() else 0
    for ch in inner:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            args += 1
    return args


def replace_format_currency(src: str) -> str:
    key = "formatCurrency("
    out: list[str] = []
    i = 0
    while True:
        j = src.find(key, i)
        if j < 0:
            out.append(src[i:])
            break
        out.append(src[i:j])
        start = j + len(key)
        depth = 1
        k = start
        while k < len(src) and depth:
            if src[k] == "(":
                depth += 1
            elif src[k] == ")":
                depth -= 1
            k += 1
        inner = src[start : k - 1]
        if top_level_arg_count(inner) == 1:
            out.append(f"money({inner})")
        else:
            out.append(f"formatCurrency({inner})")
        i = k
    return "".join(out)


def strip_format_currency_import(src: str) -> str:
    def repl(m: re.Match[str]) -> str:
        names = [n.strip() for n in m.group(1).split(",") if n.strip() and n.strip() != "formatCurrency"]
        if not names:
            return ""
        return f"import {{ {', '.join(names)} }} from '{m.group(2)}';"

    src = re.sub(
        r"import \{([^}]+)\} from '(@/lib/utils)';\n?",
        repl,
        src,
    )
    src = re.sub(r"\n{3,}", "\n\n", src)
    return src


def ensure_hook_import(src: str) -> str:
    if "useCompanyMoney" in src and HOOK_IMPORT in src:
        return src
    if HOOK_IMPORT in src:
        return src
    lines = src.splitlines(keepends=True)
    last_import = -1
    for i, line in enumerate(lines):
        if line.startswith("import "):
            last_import = i
    if last_import < 0:
        return HOOK_IMPORT + "\n" + src
    lines.insert(last_import + 1, HOOK_IMPORT + "\n")
    return "".join(lines)


def ensure_hook_call(src: str) -> str:
    if "useCompanyMoney()" in src:
        return src
    m = re.search(r"export default function \w+\([^)]*\) \{", src)
    if not m:
        return src
    return src[: m.end()] + "\n  const { money } = useCompanyMoney();" + src[m.end() :]


def patch_file(path: Path) -> bool:
    if path in SKIP:
        return False
    original = path.read_text(encoding="utf-8")
    if "formatCurrency(" not in original:
        return False
    src = replace_format_currency(original)
    if src == original:
        return False
    if "money(" in src and "useCompanyMoney" not in src:
        src = ensure_hook_import(src)
        src = ensure_hook_call(src)
    if "formatCurrency(" not in src:
        src = strip_format_currency_import(src)
        src = ensure_hook_import(src)
    if src != original:
        path.write_text(src, encoding="utf-8")
        return True
    return False


def main() -> None:
    changed = []
    for path in sorted((ROOT / "src/app/(dashboard)").rglob("*.tsx")):
        if patch_file(path):
            changed.append(str(path.relative_to(ROOT)))
    extra = ROOT / "src/components/ui/RecordViewModal.tsx"
    # RecordViewModal is not a default-export page; handle separately.
    print("patched", len(changed), "files")
    for c in changed:
        print(" ", c)


if __name__ == "__main__":
    main()
