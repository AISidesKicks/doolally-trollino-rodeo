#!/usr/bin/env python3
"""Build the curated high-risk topical context dataset.

Stages:
    1. raw   - download the small source files and write candidate rows to
               scratch/datasets/raw/*.jsonl
    2. work  - dedupe, length-limit and balance the classes, then write
               scratch/datasets/work/curated.jsonl and selected.jsonl
    3. final - assign folds and write
               datasets/<name>.jsonl
               datasets/<name>.csv
               datasets/<name>.manifest.json

Length policy:
    d1-3B has a 32,768-token context, LFM2.5-8B-A1B has 128,000. The default
    cap is 2,000 characters (about 500 English tokens). That is roughly 1.5
    percent of the d1 context, keeps both models on the same short input and
    makes a batch of 3 readable on screen.

Hugging Face:
    Set HF_TOKEN in .env for higher rate limits. The token is loaded into the
    process environment and never written to any output file.

Usage:
    pixi run python lab/datasets/build.py --per-class 2500
    pixi run python lab/datasets/build.py --target 200 --name high-risk-200
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import re
import statistics
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRATCH_DIR = PROJECT_ROOT / "scratch" / "datasets"
RAW_DIR = SCRATCH_DIR / "raw"
WORK_DIR = SCRATCH_DIR / "work"
DATASETS_DIR = PROJECT_ROOT / "datasets"


def load_env(path: Path) -> None:
    """Load simple KEY=VALUE lines without printing the values."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value:
            os.environ.setdefault(key, value)


load_env(PROJECT_ROOT / ".env")
os.environ.setdefault("HF_HOME", str(PROJECT_ROOT / "scratch" / "hf-cache"))

import pyarrow.parquet as pq  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402

LABELS = (
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

# World and Business headlines. Sports and Sci/Tech add too much noise
# ("tennis court", "player contract").
AG_LEGAL_LABELS = {0, 2}

LEGAL_STRONG_RE = re.compile(
    r"\b("
    r"lawsuit|litigation|attorney|prosecutor|judge|verdict|indictment|"
    r"compliance|regulat(?:ion|ory|e)|statute|sued|settlement|"
    r"supreme court|federal court|court ruling|court case|"
    r"breach of contract|contract dispute"
    r")\b",
    re.IGNORECASE,
)

LEGAL_WEAK_RE = re.compile(
    r"\b(court|law|illegal|crime|criminal|arrest|investigation|investigated|police|law enforcement)\b",
    re.IGNORECASE,
)

FINANCE_RE = re.compile(
    r"\b("
    r"bank|banking|stock|stocks|invest|investment|investor|loan|mortgage|"
    r"credit|debit|tax|taxes|money|finance|financial|insurance|payment|"
    r"refund|invoice|budget|debt|crypto|bitcoin|ethereum|market|trading|"
    r"profit|revenue|salary|fund|funding|economy|economic|business|company|"
    r"companies|shares|dividend|accounting|commerce|e-commerce"
    r")\b",
    re.IGNORECASE,
)

HEALTH_RE = re.compile(
    r"\b("
    r"health|medical|medicine|doctor|symptom|pain|disease|treatment|cure|"
    r"illness|injury|hospital|drug|medication|therapy|mental|depress|anxiet|"
    r"pregnan|diet|nutrition|fitness|surgery|infection|allerg|virus|bacteria|"
    r"cancer|diabetes|blood|bone|bones|skin|sleep|hormone|pms"
    r")\b",
    re.IGNORECASE,
)

POLITICS_RE = re.compile(
    r"\b("
    r"government|governor|president|election|vote|voter|senate|"
    r"congress(?:ional)?|parliament|law|policy|politic|democrat|republican|"
    r"campaign|candidate|minister|mayor|state|federal|court|constitution|"
    r"immigration|war|military|tax"
    r")\b",
    re.IGNORECASE,
)

TOPIC_ANCHORS = {
    "Financial & Crypto": FINANCE_RE,
    "Medical & Health": HEALTH_RE,
    "Politics & Elections": POLITICS_RE,
}

FIELDS = [
    "id",
    "text",
    "label",
    "source",
    "source_id",
    "source_label",
    "fold",
    "char_count",
    "word_count",
    "token_estimate",
    "truncated",
]

YAHOO_REPO = "yassiracharki/Yahoo_Answers_10_categories_for_NLP"
YAHOO_FILE = "test.csv"
AG_NEWS_REPO = "fancyzhx/ag_news"
AG_NEWS_FILE = "data/train-00000-of-00001.parquet"


def clean_text(value: object) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split())


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def estimate_tokens(text: str) -> int:
    # Conservative English estimate. Good enough for a length budget.
    return max(1, round(len(text) / 4))


def truncate_text(text: str, max_chars: int) -> tuple[str, bool]:
    if len(text) <= max_chars:
        return text, False
    window = text[:max_chars]
    cut = max(window.rfind("."), window.rfind("!"), window.rfind("?"))
    if cut >= int(max_chars * 0.6):
        return window[: cut + 1].strip(), True
    return window.rstrip(), True


def yahoo_text(row: dict[str, str]) -> str:
    parts = [
        clean_text(row.get("question_title")),
        clean_text(row.get("question_content")),
        clean_text(row.get("best_answer")),
    ]
    return clean_text(" ".join(part for part in parts if part))


def download(repo_id: str, filename: str) -> Path:
    print(f"Downloading {repo_id}/{filename} ...")
    path = Path(hf_hub_download(repo_id=repo_id, filename=filename, repo_type="dataset"))
    print(f"  {path.stat().st_size / 1_000_000:.1f} MB")
    return path


def legal_match(text: str, source: str) -> bool:
    """Require a strong legal term, or several weak ones.

    Yahoo Answers gets a stricter threshold so riddles that only mention the
    police are not pulled into the Legal class. AG News headlines get a softer
    threshold because they are short and often elliptical.
    """
    if LEGAL_STRONG_RE.search(text):
        return True
    threshold = 3 if source == "yahoo_answers" else 2
    return len(LEGAL_WEAK_RE.findall(text)) >= threshold


def build_raw(args: argparse.Namespace) -> Counter[str]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    counters: Counter[str] = Counter()
    seen: set[str] = set()

    yahoo_path = download(YAHOO_REPO, YAHOO_FILE)
    ag_path = download(AG_NEWS_REPO, AG_NEWS_FILE)

    print("Scanning Yahoo Answers ...")
    yahoo_out = RAW_DIR / "yahoo_answers.jsonl"
    with yahoo_path.open(newline="", encoding="utf-8") as source, yahoo_out.open("w", encoding="utf-8") as target:
        for index, row in enumerate(csv.DictReader(source)):
            text = yahoo_text(row)
            counters["yahoo_scanned"] += 1
            if len(text) < args.min_chars:
                counters["yahoo_short"] += 1
                continue
            digest = text_hash(text)
            if digest in seen:
                counters["yahoo_duplicate"] += 1
                continue
            source_label = int(row["class_index"])
            base_label = YAHOO_LABELS.get(source_label)
            is_legal = legal_match(text, "yahoo_answers")
            if base_label is None and not is_legal:
                counters["yahoo_skipped"] += 1
                continue
            if base_label is not None and not is_legal and not TOPIC_ANCHORS[base_label].search(text):
                counters["yahoo_off_topic"] += 1
                continue
            seen.add(digest)
            record = {
                "text": text,
                "text_hash": digest,
                "base_label": base_label,
                "is_legal": is_legal,
                "source": "yahoo_answers",
                "source_id": f"yahoo:test:{index}",
                "source_label": str(source_label),
            }
            target.write(json.dumps(record, ensure_ascii=False) + "\n")
            counters["yahoo_kept"] += 1
            if counters["yahoo_scanned"] % 10_000 == 0:
                print(f"  scanned {counters['yahoo_scanned']} rows, kept {counters['yahoo_kept']}")

    print("Scanning AG News ...")
    ag_out = RAW_DIR / "ag_news.jsonl"
    rows = pq.read_table(ag_path).to_pylist()
    with ag_out.open("w", encoding="utf-8") as target:
        for index, row in enumerate(rows):
            text = clean_text(row["text"])
            counters["ag_scanned"] += 1
            if len(text) < args.min_chars:
                counters["ag_short"] += 1
                continue
            digest = text_hash(text)
            if digest in seen:
                counters["ag_duplicate"] += 1
                continue
            source_label = int(row["label"])
            base_label = "Financial & Crypto" if source_label == 2 else None
            is_legal = source_label in AG_LEGAL_LABELS and legal_match(text, "ag_news")
            if base_label is None and not is_legal:
                counters["ag_skipped"] += 1
                continue
            seen.add(digest)
            record = {
                "text": text,
                "text_hash": digest,
                "base_label": base_label,
                "is_legal": is_legal,
                "source": "ag_news",
                "source_id": f"ag_news:train:{index}",
                "source_label": str(source_label),
            }
            target.write(json.dumps(record, ensure_ascii=False) + "\n")
            counters["ag_kept"] += 1
            if counters["ag_scanned"] % 20_000 == 0:
                print(f"  scanned {counters['ag_scanned']} rows, kept {counters['ag_kept']}")

    print("Raw candidates:")
    for key in ("yahoo_scanned", "yahoo_kept", "yahoo_short", "yahoo_duplicate", "yahoo_skipped",
                "yahoo_off_topic", "ag_scanned", "ag_kept", "ag_short", "ag_duplicate", "ag_skipped"):
        print(f"  {key:18s} {counters[key]}")
    return counters


def load_raw() -> list[dict]:
    records: list[dict] = []
    for path in sorted(RAW_DIR.glob("*.jsonl")):
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    records.append(json.loads(line))
    return records


def curate(records: list[dict], args: argparse.Namespace) -> tuple[list[dict], Counter[str]]:
    curated: list[dict] = []
    dropped: Counter[str] = Counter()
    seen: set[str] = set()
    for record in records:
        digest = record["text_hash"]
        if digest in seen:
            dropped["duplicate"] += 1
            continue
        seen.add(digest)
        text, truncated = truncate_text(record["text"], args.max_chars)
        if len(text) < args.min_chars:
            dropped["short_after_truncate"] += 1
            continue
        curated.append(
            {
                **record,
                "text": text,
                "truncated": truncated,
                "char_count": len(text),
                "word_count": len(text.split()),
                "token_estimate": estimate_tokens(text),
            }
        )
    return curated, dropped


def shuffle(records: list[dict], seed: str) -> list[dict]:
    records = list(records)
    random.Random(seed).shuffle(records)
    return records


def take(records: list[dict], count: int, used: set[str], label: str) -> list[dict]:
    picked: list[dict] = []
    for record in records:
        if len(picked) >= count:
            break
        if record["text_hash"] in used:
            continue
        used.add(record["text_hash"])
        picked.append({**record, "label": label})
    return picked


def select(curated: list[dict], args: argparse.Namespace) -> tuple[list[dict], Counter[str]]:
    by_base: dict[str, list[dict]] = defaultdict(list)
    for record in curated:
        if record["base_label"]:
            by_base[record["base_label"]].append(record)

    used: set[str] = set()
    selected: list[dict] = []

    # Medical and politics come from non-legal Yahoo rows. Legal rows are kept
    # for the Legal class instead of stealing them from their base class.
    for label in ("Medical & Health", "Politics & Elections"):
        pool = [r for r in by_base[label] if not r["is_legal"]]
        selected += take(shuffle(pool, f"{args.seed}:{label}"), args.per_class, used, label)
        have = sum(1 for r in selected if r["label"] == label)
        print(f"{label}: {have}/{args.per_class}")

    # Financial mix: 80 percent Yahoo, 20 percent AG News.
    financial = "Financial & Crypto"
    yahoo_financial = [
        r for r in by_base[financial] if r["source"] == "yahoo_answers" and not r["is_legal"]
    ]
    ag_financial = [
        r for r in by_base[financial] if r["source"] == "ag_news" and not r["is_legal"]
    ]
    yahoo_target = int(args.per_class * 0.8)
    selected += take(shuffle(yahoo_financial, f"{args.seed}:fin-yahoo"), yahoo_target, used, financial)
    have = sum(1 for r in selected if r["label"] == financial)
    selected += take(shuffle(ag_financial, f"{args.seed}:fin-ag"), args.per_class - have, used, financial)
    have = sum(1 for r in selected if r["label"] == financial)
    if have < args.per_class:
        pool = [r for r in by_base[financial] if r["text_hash"] not in used]
        selected += take(shuffle(pool, f"{args.seed}:fin-fill"), args.per_class - have, used, financial)
    print(f"{financial}: {sum(1 for r in selected if r['label'] == financial)}/{args.per_class}")

    # Legal mix: Yahoo first, then AG News World and Business.
    legal = "Legal & Regulatory"
    yahoo_legal = [r for r in curated if r["is_legal"] and r["source"] == "yahoo_answers"]
    ag_legal = [r for r in curated if r["is_legal"] and r["source"] == "ag_news"]
    yahoo_target = min(len(yahoo_legal), int(args.per_class * 0.7))
    selected += take(shuffle(yahoo_legal, f"{args.seed}:legal-yahoo"), yahoo_target, used, legal)
    have = sum(1 for r in selected if r["label"] == legal)
    selected += take(shuffle(ag_legal, f"{args.seed}:legal-ag"), args.per_class - have, used, legal)
    have = sum(1 for r in selected if r["label"] == legal)
    if have < args.per_class:
        pool = [r for r in curated if r["is_legal"] and r["text_hash"] not in used]
        selected += take(shuffle(pool, f"{args.seed}:legal-fill"), args.per_class - have, used, legal)
    print(f"{legal}: {sum(1 for r in selected if r['label'] == legal)}/{args.per_class}")

    # If a class is still short, report it clearly. Do not silently rebalance.
    counts = Counter(r["label"] for r in selected)
    missing = {label: args.per_class - counts[label] for label in LABELS if counts[label] < args.per_class}
    if missing:
        raise SystemExit(f"Not enough rows for: {missing}. Lower --per-class or add sources.")

    if len(selected) != args.per_class * len(LABELS):
        raise SystemExit(f"Selected {len(selected)} rows, expected {args.per_class * len(LABELS)}")

    return selected, counts


def assign_folds(selected: list[dict], args: argparse.Namespace) -> None:
    fold_size = args.per_class // 10
    if fold_size == 0:
        raise SystemExit("--per-class must be at least 10")
    for label in LABELS:
        rows = [r for r in selected if r["label"] == label]
        random.Random(f"{args.seed}:fold:{label}").shuffle(rows)
        for index, record in enumerate(rows):
            if index < fold_size * 8:
                record["fold"] = f"fold-{index // fold_size}"
            else:
                record["fold"] = "holdout"


def order_hash(args: argparse.Namespace, record: dict) -> str:
    """Stable hash order, so the file is mixed instead of grouped by fold.

    The order does not depend on Python's random module, so it can be
    reproduced by any tool that can compute SHA-256.
    """
    return hashlib.sha256(f"{args.seed}:order:{record['id']}".encode("utf-8")).hexdigest()



def percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    index = min(len(values) - 1, int(len(values) * fraction))
    return values[index]


def summarize(records: list[dict]) -> dict:
    chars = sorted(r["char_count"] for r in records)
    words = sorted(r["word_count"] for r in records)
    tokens = sorted(r["token_estimate"] for r in records)

    def distribution(values: list[int]) -> dict[str, int]:
        return {
            "min": values[0],
            "p50": percentile(values, 0.50),
            "p90": percentile(values, 0.90),
            "p99": percentile(values, 0.99),
            "max": values[-1],
            "mean": round(statistics.mean(values), 1),
        }

    return {
        "rows": len(records),
        "classes": dict(Counter(r["label"] for r in records)),
        "sources": dict(Counter(r["source"] for r in records)),
        "folds": dict(Counter(r["fold"] for r in records)),
        "chars": distribution(chars),
        "words": distribution(words),
        "tokens_estimate": distribution(tokens),
        "truncated": sum(1 for r in records if r["truncated"]),
    }


def write_outputs(selected: list[dict], args: argparse.Namespace, raw_counts: Counter[str], dropped: Counter[str]) -> dict:
    DATASETS_DIR.mkdir(parents=True, exist_ok=True)
    jsonl_path = DATASETS_DIR / f"{args.name}.jsonl"
    csv_path = DATASETS_DIR / f"{args.name}.csv"
    manifest_path = DATASETS_DIR / f"{args.name}.manifest.json"

    with jsonl_path.open("w", encoding="utf-8") as handle:
        for record in selected:
            handle.write(json.dumps({key: record[key] for key in FIELDS}, ensure_ascii=False) + "\n")

    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        for record in selected:
            writer.writerow({key: record[key] for key in FIELDS})

    stats = summarize(selected)
    manifest = {
        "name": args.name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed,
        "per_class": args.per_class,
        "total": len(selected),
        "max_chars": args.max_chars,
        "min_chars": args.min_chars,
        "context_limits": {
            "d1-3B": 32768,
            "LFM2.5-8B-A1B": 128000,
        },
        "sources": {
            "yahoo_answers": f"{YAHOO_REPO}/{YAHOO_FILE}",
            "ag_news": f"{AG_NEWS_REPO}/{AG_NEWS_FILE}",
        },
        "raw_counts": dict(raw_counts),
        "dropped": dict(dropped),
        "row_order": f"global sha256 shuffle, seed {args.seed}",
        "stats": stats,
        "notes": [
            "Legal & Regulatory is keyword-filtered, not human-labeled.",
            "Yahoo Answers labels are noisy.",
            "token_estimate is chars / 4, not a real tokenizer count.",
            "Text above max_chars is cut at a sentence boundary when possible.",
        ],
    }
    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")

    print("")
    print(f"Wrote {len(selected)} rows to {jsonl_path}")
    print(f"Wrote CSV view to {csv_path}")
    print(f"Wrote manifest to {manifest_path}")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--per-class", type=int, default=2500, help="rows per class (default: 2500)")
    parser.add_argument("--target", type=int, default=None, help="total rows, overrides --per-class")
    parser.add_argument("--max-chars", type=int, default=2000, help="hard text cap in characters (default: 2000)")
    parser.add_argument("--min-chars", type=int, default=40, help="drop texts shorter than this (default: 40)")
    parser.add_argument("--seed", type=int, default=42, help="shuffle and fold seed")
    parser.add_argument("--name", default="high-risk-10k", help="output basename (default: high-risk-10k)")
    parser.add_argument("--reuse-raw", action="store_true", help="reuse scratch/datasets/raw files, skip downloads")
    args = parser.parse_args()

    if args.target is not None:
        if args.target % len(LABELS) != 0:
            raise SystemExit(f"--target must be divisible by {len(LABELS)}")
        args.per_class = args.target // len(LABELS)

    started = time.time()
    print(f"Target: {args.per_class * len(LABELS)} rows, {args.per_class} per class")
    print(f"Text cap: {args.max_chars} chars (about {args.max_chars // 4} tokens)")

    if args.reuse_raw:
        if not list(RAW_DIR.glob("*.jsonl")):
            raise SystemExit(f"--reuse-raw set but no files in {RAW_DIR}")
        print(f"Reusing raw candidates from {RAW_DIR}")
        raw_counts = Counter({"reused": 1})
    else:
        raw_counts = build_raw(args)

    print("Loading raw candidates ...")
    records = load_raw()
    print(f"  {len(records)} candidate rows")

    print("Curating ...")
    curated, dropped = curate(records, args)
    print(f"  {len(curated)} rows after dedupe and length limits")
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    with (WORK_DIR / "curated.jsonl").open("w", encoding="utf-8") as handle:
        for record in curated:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    print("Selecting classes ...")
    selected, counts = select(curated, args)

    for record in selected:
        record["id"] = "hr-" + record["text_hash"][:12]
    ids = [r["id"] for r in selected]
    if len(ids) != len(set(ids)):
        raise SystemExit("ID collision, increase the hash prefix")

    assign_folds(selected, args)
    selected = sorted(selected, key=lambda record: order_hash(args, record))

    with (WORK_DIR / "selected.jsonl").open("w", encoding="utf-8") as handle:
        for record in selected:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    manifest = write_outputs(selected, args, raw_counts, dropped)
    stats = manifest["stats"]
    print("")
    print("Class counts:", stats["classes"])
    print("Source counts:", stats["sources"])
    print("Fold counts:", stats["folds"])
    print("Chars:", stats["chars"])
    print("Tokens (estimate):", stats["tokens_estimate"])
    print(f"Truncated rows: {stats['truncated']}")
    print(f"Done in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
