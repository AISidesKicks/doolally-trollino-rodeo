# Dataset plan

Goal: one canonical pool of short high-risk topical context rows that can drive the 100-task pilot, the 1,000-task short play and the 10,000-task long play without rebuilding anything.

## Shape

| Item | Value |
| --- | --- |
| Total rows | 10,000 |
| Rows per class | 2,500 |
| Experiment folds | 8 x 1,000 rows (250 per class) |
| Holdout | 2,000 rows (500 per class) |
| Play modes | pilot 100, short 1,000, long 10,000 |

The holdout is part of the 10,000-row file but is not used while tuning prompts. The long run can use the 8 folds (8,000 rows) first and switch to all 10,000 for the final benchmark.

## Fields

| Field | Meaning |
| --- | --- |
| `id` | stable `hr-` + first 12 hex of the SHA-256 of the text |
| `text` | cleaned and length-capped input |
| `label` | one of the four target classes |
| `source` | `yahoo_answers` or `ag_news` |
| `source_id` | source row reference |
| `source_label` | original dataset label |
| `fold` | `fold-0` ... `fold-7` or `holdout` |
| `char_count` | characters after cleaning and truncation |
| `word_count` | whitespace words |
| `token_estimate` | `chars / 4`, a budget estimate, not a tokenizer count |
| `truncated` | true when the text was cut |

## Length policy

- d1-3B context: **32,768 tokens**. LFM2.5-8B-A1B: **128,000 tokens**.
- Default cap: **2,000 characters**, about 500 English tokens. That is about 1.5 percent of the d1 context.
- Text longer than the cap is cut at the last sentence boundary inside the window when possible.
- Minimum length: 40 characters.
- Why so short: classification needs the topic, not the whole article. Short inputs keep both models comparable, keep latency low and let a batch of 3 fit on screen.

## Label rules

- Yahoo Answers `class_index` 3 -> Medical & Health.
- Yahoo Answers `class_index` 7 -> Financial & Crypto unless the legal filter matches.
- Yahoo Answers `class_index` 10 -> Politics & Elections unless the legal filter matches.
- Yahoo other classes -> Legal & Regulatory only when the legal filter matches.
- AG News Business -> Financial & Crypto unless the legal filter matches.
- AG News World and Business -> Legal & Regulatory when the legal filter matches. Sports and Sci/Tech are excluded to avoid "tennis court" and "player contract" noise.
- Topic anchors: Medical, Politics and Financial rows must contain at least one anchor word from their topic (for example `doctor`, `election`, `mortgage`). This drops obvious noise such as a laundry question labeled Financial.
- Legal filter: one strong term (`lawsuit`, `judge`, `compliance`, `regulation`) or several weak terms (`court`, `police`, `arrest`). Yahoo gets the stricter threshold so riddles that only mention the police are not pulled in.
- Medical and Politics use non-legal rows first, so the Legal class does not steal their rows.
- Financial mix: about 80 percent Yahoo, 20 percent AG News.
- Legal mix: all usable Yahoo legal rows first, then AG News fills the rest.

## Storage

Working data stays in `scratch/`:

```
scratch/datasets/raw/yahoo_answers.jsonl
scratch/datasets/raw/ag_news.jsonl
scratch/datasets/work/curated.jsonl
scratch/datasets/work/selected.jsonl
```

Final data goes to `datasets/`:

```
datasets/high-risk-10k.jsonl
datasets/high-risk-10k.csv
datasets/high-risk-10k.manifest.json
```

## Commands

```bash
# build the full 10k pool
pixi run python lab/datasets/build.py --per-class 2500

# reuse the raw candidates while tuning the curation
pixi run python lab/datasets/build.py --per-class 2500 --reuse-raw

# small pilot pool
pixi run python lab/datasets/build.py --target 200 --name high-risk-200
```

`HF_TOKEN` is read from `.env` when present. It is never written to the dataset or the manifest.

## Checks

The builder verifies:

- exactly 10,000 rows and 2,500 per class,
- 1,000 rows per fold and 250 per class per fold,
- 2,000 holdout rows and 500 per class,
- no duplicate IDs or texts,
- no text above `--max-chars`.

The manifest records class, source and fold counts, length percentiles, the seed and the source files.
