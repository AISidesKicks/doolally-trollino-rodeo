#!/usr/bin/env python3
"""Create a deterministic stratified play batch from the canonical dataset.

Taking the first N lines of a dataset can silently pick one fold, one source or
one class. This sampler orders every class by a SHA-256 key and takes the first
N per class, so a 100-task run spreads over the whole pool instead of the top
of the file.

Modes:
    100    -> 25 rows per class
    1000   -> 250 rows per class
    10000  -> the whole pool, shuffled

Usage:
    pixi run python lab/datasets/sample.py --mode 100
    pixi run python lab/datasets/sample.py --mode 1000 --exclude-holdout
    pixi run python lab/datasets/sample.py --mode 1000 --fold fold-0

Output defaults to scratch/datasets/work/play-<mode>.jsonl with a manifest
next to it. The generated batch is a play list, not a replacement for the
canonical dataset.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = PROJECT_ROOT / "datasets" / "high-risk-10k.jsonl"
WORK_DIR = PROJECT_ROOT / "scratch" / "datasets" / "work"

LABELS = (
    "Politics & Elections",
    "Medical & Health",
    "Legal & Regulatory",
    "Financial & Crypto",
)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"Input not found: {path}")
    rows: list[dict] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def order_key(seed: int, mode: int, label: str, record_id: str) -> str:
    return sha256_text(f"{seed}:{mode}:{label}:{record_id}")


def select(
    rows: list[dict],
    mode: int,
    seed: int,
    fold: str | None = None,
    exclude_holdout: bool = False,
) -> list[dict]:
    if mode % len(LABELS) != 0:
        raise SystemExit(f"Mode {mode} is not divisible by {len(LABELS)} classes")

    pool = rows
    if fold:
        pool = [row for row in pool if row.get("fold") == fold]
        if not pool:
            raise SystemExit(f"Fold {fold!r} has no rows")
    if exclude_holdout:
        pool = [row for row in pool if row.get("fold") != "holdout"]

    per_class = mode // len(LABELS)
    selected: list[dict] = []
    for label in LABELS:
        candidates = [row for row in pool if row.get("label") == label]
        candidates.sort(key=lambda row: order_key(seed, mode, label, row["id"]))
        if len(candidates) < per_class:
            raise SystemExit(
                f"Mode {mode} needs {per_class} rows for {label}, "
                f"but the filtered pool has {len(candidates)}"
            )
        selected.extend(candidates[:per_class])

    # Mix the classes in the output as well. Batch 1 should not be four
    # politics rows followed by four medical rows.
    selected.sort(key=lambda row: sha256_text(f"{seed}:{mode}:order:{row['id']}"))
    return selected


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--mode", type=int, choices=(100, 1000, 10000), default=100)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--fold", default=None, help="sample only from this fold")
    parser.add_argument("--exclude-holdout", action="store_true", help="keep the holdout out of the batch")
    args = parser.parse_args()

    if args.fold and args.exclude_holdout:
        raise SystemExit("Use --fold or --exclude-holdout, not both")

    suffix = f"-{args.fold}" if args.fold else "-no-holdout" if args.exclude_holdout else ""
    out_path = args.out or WORK_DIR / f"play-{args.mode}{suffix}.jsonl"
    manifest_path = out_path.with_suffix(".manifest.json")

    rows = read_jsonl(args.input)
    selected = select(rows, args.mode, args.seed, args.fold, args.exclude_holdout)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        for position, record in enumerate(selected, start=1):
            row = {
                **record,
                "position": position,
                "play": args.mode,
                "play_seed": args.seed,
            }
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    manifest = {
        "mode": args.mode,
        "seed": args.seed,
        "selection": "stratified sha256 hash sample",
        "per_class": args.mode // len(LABELS),
        "rows": len(selected),
        "filters": {
            "fold": args.fold,
            "exclude_holdout": args.exclude_holdout,
        },
        "classes": dict(Counter(row["label"] for row in selected)),
        "sources": dict(Counter(row["source"] for row in selected)),
        "folds": dict(Counter(row["fold"] for row in selected)),
        "input": str(args.input),
        "input_sha256": sha256_file(args.input),
        "output": str(out_path),
        "output_sha256": sha256_file(out_path),
        "first_ids": [row["id"] for row in selected[:8]],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")

    print(f"Mode {args.mode}: {len(selected)} rows -> {out_path}")
    print(f"  per class: {manifest['per_class']}")
    print(f"  classes:   {manifest['classes']}")
    print(f"  sources:   {manifest['sources']}")
    print(f"  folds:     {manifest['folds']}")
    print("  first 8:", ", ".join(manifest["first_ids"]))
    print(f"  manifest:  {manifest_path}")


if __name__ == "__main__":
    main()
