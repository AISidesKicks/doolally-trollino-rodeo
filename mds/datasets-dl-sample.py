"""Build a small, bootstrap-sized high-risk topical context dataset.

Downloads only the small source files:
    Yahoo Answers test.csv      about 32 MB
    AG News test parquet        about 1.2 MB

The script stops after a few hundred rows. Use --per-class to scale up later.

Yahoo Answers label IDs come from classes.txt in the dataset repo:
    1 = Society & Culture        6 = Sports
    2 = Science & Mathematics    7 = Business & Finance
    3 = Health                   8 = Entertainment & Music
    4 = Education & Reference    9 = Family & Relationships
    5 = Computers & Internet    10 = Politics & Government
"""

from __future__ import annotations

import argparse
import csv
import os
import random
import re
import time
from collections import Counter
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HOME", str(PROJECT_ROOT / "scratch" / "hf-cache"))

import pyarrow.parquet as pq  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402

YAHOO_REPO = "yassiracharki/Yahoo_Answers_10_categories_for_NLP"
YAHOO_FILE = "test.csv"
AG_NEWS_REPO = "fancyzhx/ag_news"
AG_NEWS_FILE = "data/test-00000-of-00001.parquet"

CLASSES = (
    "Politics & Elections",
    "Medical & Health",
    "Legal & Regulatory",
    "Financial & Crypto",
)

YAHOO_LABELS = {
    3: "Medical & Health",
    7: "Financial & Crypto",
    10: "Politics & Elections",
}

MIXED_CLASSES = {"Legal & Regulatory", "Financial & Crypto"}

LEGAL_RE = re.compile(
    r"\b(court|lawsuit|sued|compliance|regulation|attorney|judge|illegal|contract)\b",
    re.IGNORECASE,
)

MIN_TEXT_LEN = 20
PROGRESS_EVERY = 5000


def clean(text: object) -> str:
    if text is None:
        return ""
    return " ".join(str(text).split())


def yahoo_text(row: dict[str, str]) -> str:
    parts = [
        clean(row.get("question_title")),
        clean(row.get("question_content")),
        clean(row.get("best_answer")),
    ]
    return clean(" ".join(part for part in parts if part))


def add(buckets: dict[str, list[dict[str, str]]], cap: int, label: str, text: str, source: str) -> bool:
    if len(text) < MIN_TEXT_LEN:
        return False
    if len(buckets[label]) >= cap:
        return False
    buckets[label].append({"text": text, "label": label, "source": source})
    return True


def full(buckets: dict[str, list[dict[str, str]]], cap: int) -> bool:
    return all(len(rows) >= cap for rows in buckets.values())


def describe_size(path: str) -> str:
    return f"{Path(path).stat().st_size / 1_000_000:.1f} MB"


def build(per_class: int, max_scan: int, ag_reserve: int, output: Path, seed: int) -> None:
    started = time.time()
    buckets: dict[str, list[dict[str, str]]] = {label: [] for label in CLASSES}
    source_counts: Counter[str] = Counter()
    scanned = 0
    mixed_cap = max(per_class - ag_reserve, 0)

    print(f"Bootstrap target: {per_class} rows per class ({per_class * len(CLASSES)} total)")
    print(f"Yahoo cap for financial and legal: {mixed_cap} (AG News reserve: {ag_reserve})")

    print("Downloading Yahoo Answers test split...")
    yahoo_path = hf_hub_download(repo_id=YAHOO_REPO, filename=YAHOO_FILE, repo_type="dataset")
    print(f"  {YAHOO_FILE} ({describe_size(yahoo_path)})")

    print("Downloading AG News test split...")
    ag_path = hf_hub_download(repo_id=AG_NEWS_REPO, filename=AG_NEWS_FILE, repo_type="dataset")
    print(f"  {AG_NEWS_FILE} ({describe_size(ag_path)})")

    print("Scanning Yahoo Answers...")
    with open(yahoo_path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if scanned >= max_scan or full(buckets, per_class):
                break
            scanned += 1
            label = YAHOO_LABELS.get(int(row["class_index"]))
            if not label:
                continue
            text = yahoo_text(row)
            target = label
            if LEGAL_RE.search(text) and len(buckets["Legal & Regulatory"]) < mixed_cap:
                target = "Legal & Regulatory"
            cap = mixed_cap if target in MIXED_CLASSES else per_class
            if add(buckets, cap, target, text, "yahoo_answers"):
                source_counts["yahoo_answers"] += 1
            if scanned % PROGRESS_EVERY == 0:
                print(f"  scanned {scanned} rows, have {sum(len(v) for v in buckets.values())} samples")

    print("Scanning AG News...")
    for row in pq.read_table(ag_path).to_pylist():
        if scanned >= max_scan or full(buckets, per_class):
            break
        scanned += 1
        text = clean(row["text"])
        if LEGAL_RE.search(text) and len(buckets["Legal & Regulatory"]) < per_class:
            target = "Legal & Regulatory"
        elif int(row["label"]) == 2:  # Business
            target = "Financial & Crypto"
        else:
            continue
        if add(buckets, per_class, target, text, "ag_news"):
            source_counts["ag_news"] += 1
        if scanned % PROGRESS_EVERY == 0:
            print(f"  scanned {scanned} rows, have {sum(len(v) for v in buckets.values())} samples")

    rows = [row for label in CLASSES for row in buckets[label]]
    random.Random(seed).shuffle(rows)

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["text", "label", "source"])
        writer.writeheader()
        writer.writerows(rows)

    elapsed = time.time() - started
    print("")
    print(f"Wrote {len(rows)} rows to {output}")
    print(f"Scanned {scanned} source rows in {elapsed:.1f}s")
    print("Per class:")
    for label in CLASSES:
        print(f"  {label:22s} {len(buckets[label]):4d}")
    print("Per source:", dict(source_counts))

    short = [label for label in CLASSES if len(buckets[label]) < per_class]
    if short:
        print("")
        print("Warning: quotas not reached for:", ", ".join(short))
        print("Raise --max-scan or add a second source for those classes.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-class", type=int, default=50, help="rows per class (default: 50, about 200 total)")
    parser.add_argument("--ag-reserve", type=int, default=10, help="rows per mixed class to leave for AG News")
    parser.add_argument("--max-scan", type=int, default=200_000, help="stop after this many source rows")
    parser.add_argument("--seed", type=int, default=42, help="shuffle seed for the output file")
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "datasets" / "high_risk_bootstrap.csv",
        help="output CSV path",
    )
    args = parser.parse_args()
    build(args.per_class, args.max_scan, args.ag_reserve, args.output, args.seed)


if __name__ == "__main__":
    main()
