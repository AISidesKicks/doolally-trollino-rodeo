"""Check that SOURCES.json still describes the committed dataset."""

from __future__ import annotations

import hashlib
import json
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "datasets" / "high-risk-10k.jsonl"
SOURCES = ROOT / "datasets" / "SOURCES.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class SourcesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sources = json.loads(SOURCES.read_text(encoding="utf-8"))
        with DATASET.open(encoding="utf-8") as handle:
            cls.rows = [json.loads(line) for line in handle]

    def test_dataset_hash_and_size(self) -> None:
        dataset = self.sources["dataset"]
        self.assertEqual(dataset["rows"], len(self.rows))
        self.assertEqual(dataset["size_bytes"], DATASET.stat().st_size)
        self.assertEqual(dataset["sha256"], sha256_file(DATASET))

    def test_source_counts_match_dataset(self) -> None:
        rows_by_source = Counter(row["source"] for row in self.rows)
        rows_by_source_label = Counter((row["source"], row["label"]) for row in self.rows)

        for source in self.sources["sources"]:
            source_id = source["id"]
            self.assertEqual(source["rows_used"], rows_by_source[source_id], source_id)
            for label, expected in source["rows_by_label"].items():
                self.assertEqual(rows_by_source_label[(source_id, label)], expected, f"{source_id}/{label}")

    def test_total_and_license_fields(self) -> None:
        self.assertEqual(sum(source["rows_used"] for source in self.sources["sources"]), len(self.rows))
        for source in self.sources["sources"]:
            self.assertTrue(source["declared_license"])
            self.assertTrue(source["url"].startswith("https://huggingface.co/datasets/"))


if __name__ == "__main__":
    unittest.main()
