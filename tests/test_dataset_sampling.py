"""Checks for the canonical dataset and the play batch sampler."""

from __future__ import annotations

import importlib.util
import json
import unittest
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "datasets" / "high-risk-10k.jsonl"
SAMPLE_SCRIPT = ROOT / "lab" / "datasets" / "sample.py"


def load_sampler():
    spec = importlib.util.spec_from_file_location("dataset_sample", SAMPLE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sampler = load_sampler()


class DatasetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with DATASET.open(encoding="utf-8") as handle:
            cls.rows = [json.loads(line) for line in handle]

    def test_canonical_shape(self) -> None:
        self.assertEqual(len(self.rows), 10_000)
        self.assertEqual(len({row["id"] for row in self.rows}), 10_000)
        self.assertEqual(len({row["text"] for row in self.rows}), 10_000)
        self.assertLessEqual(max(row["char_count"] for row in self.rows), 2_000)

        classes = Counter(row["label"] for row in self.rows)
        self.assertEqual(set(classes.values()), {2_500})

        folds = Counter(row["fold"] for row in self.rows)
        for index in range(8):
            self.assertEqual(folds[f"fold-{index}"], 1_000)
        self.assertEqual(folds["holdout"], 2_000)

    def test_canonical_order_is_mixed(self) -> None:
        head = self.rows[:100]
        self.assertGreater(len({row["fold"] for row in head}), 1)
        self.assertGreater(len({row["source"] for row in head}), 1)
        self.assertGreater(len({row["label"] for row in head}), 1)

    def test_mode_100_is_balanced(self) -> None:
        selected = sampler.select(self.rows, 100, 42)
        self.assertEqual(len(selected), 100)
        self.assertEqual(set(Counter(row["label"] for row in selected).values()), {25})
        self.assertEqual(len({row["id"] for row in selected}), 100)

    def test_mode_1000_is_balanced(self) -> None:
        selected = sampler.select(self.rows, 1000, 42)
        self.assertEqual(len(selected), 1_000)
        self.assertEqual(set(Counter(row["label"] for row in selected).values()), {250})

    def test_mode_10000_uses_every_row(self) -> None:
        selected = sampler.select(self.rows, 10_000, 42)
        self.assertEqual({row["id"] for row in selected}, {row["id"] for row in self.rows})

    def test_selection_is_deterministic(self) -> None:
        first = [row["id"] for row in sampler.select(self.rows, 100, 42)]
        second = [row["id"] for row in sampler.select(self.rows, 100, 42)]
        self.assertEqual(first, second)

    def test_fold_filter(self) -> None:
        selected = sampler.select(self.rows, 1_000, 42, fold="fold-0")
        self.assertEqual(len(selected), 1_000)
        self.assertEqual({row["fold"] for row in selected}, {"fold-0"})
        self.assertEqual(set(Counter(row["label"] for row in selected).values()), {250})

    def test_exclude_holdout(self) -> None:
        selected = sampler.select(self.rows, 1_000, 42, exclude_holdout=True)
        self.assertEqual(len(selected), 1_000)
        self.assertNotIn("holdout", {row["fold"] for row in selected})
        self.assertEqual(set(Counter(row["label"] for row in selected).values()), {250})

    def test_play_batch_is_not_the_first_rows(self) -> None:
        selected = sampler.select(self.rows, 100, 42)
        head_ids = {row["id"] for row in self.rows[:100]}
        self.assertNotEqual({row["id"] for row in selected}, head_ids)


if __name__ == "__main__":
    unittest.main()
