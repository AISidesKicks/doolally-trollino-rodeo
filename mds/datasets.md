# Dataset notes

Shortlist of short-topic datasets for the four high-risk topical context classes. The canonical builder is [../lab/datasets/build.py](../lab/datasets/build.py); the small smoke-test downloader is [datasets-dl-sample.py](datasets-dl-sample.py).

## Yahoo Answers 10 Categories

- Hugging Face: https://huggingface.co/datasets/yassiracharki/Yahoo_Answers_10_categories_for_NLP
- Size: 1.4M train rows, 60k test rows. The test split is enough for the canonical pool.
- Columns: `class_index`, `question_title`, `question_content`, `best_answer`.
- Relevant labels (1-based `class_index`):
  - `3` = Health -> Medical & Health
  - `7` = Business & Finance -> Financial & Crypto
  - `10` = Politics & Government -> Politics & Elections
- Labels are noisy. Some rows are clearly mislabeled, so keep the source label visible and do not over-tune on the sample.
- Declared license: Apache-2.0. The card declares it, but the rows are derived from Yahoo Answers user content, so upstream terms may still apply.

## AG News

- Hugging Face: https://huggingface.co/datasets/fancyzhx/ag_news
- Size: 120k train rows, 7.6k test rows of short news headlines.
- Labels: `0` World, `1` Sports, `2` Business, `3` Sci/Tech.
- Used for Financial & Crypto and, through the legal keyword filter, Legal & Regulatory.
- Declared license: unknown. The 1,770 AG News rows are included for educational use with attribution. Review the terms before commercial use.

## DeepPavlov Topics

- Landing page: https://deeppavlov.ai/datasets/topics
- 4.2M conversational samples across 33 topics, including politics, health and finance.
- Candidate for the scale-up after the demo works.

## Reuters-21578

- Hugging Face: https://huggingface.co/datasets/ucirvine/reuters21578
- UCI source: https://archive.ics.uci.edu/dataset/137/reuters+21578+text+categorization+collection
- Business and trading vocabulary. Candidate for financial and legal coverage.

## Llama Guard taxonomy

- Model card: https://huggingface.co/QuantFactory/Llama-Guard-3-1B-GGUF
- Reference for the hazard taxonomy behind the four target classes (Elections, Specialized Advice for medical/legal/financial).

## Canonical build

The full pool is built by [../lab/datasets/build.py](../lab/datasets/build.py). Design notes are in [../lab/datasets/README.md](../lab/datasets/README.md).

```bash
pixi run python lab/datasets/build.py --per-class 2500
```

- Output: `datasets/high-risk-10k.jsonl`, `.csv`, `.manifest.json`.
- The JSONL and manifest are tracked in Git so the lab runs without a rebuild. The CSV is local only.
- Source repos, files, row counts and licenses: `datasets/SOURCES.json`.
- 10,000 rows, 2,500 per class.
- 8 folds x 1,000 rows plus 2,000 holdout rows.
- Current source mix: 8,230 Yahoo Answers, 1,770 AG News.
- Text cap: 2,000 chars, about 500 tokens. Current p50 is 444 chars, p99 is 1,984.
- Rows are globally shuffled with a SHA-256 order key, so the top of the file is not one fold or one source.
- Play batches use `lab/datasets/sample.py` and are stratified by class: 25 per class for 100 tasks, 250 per class for 1,000 tasks, all rows for 10,000 tasks.
- Downloads: Yahoo `test.csv` (32 MB) and AG News train parquet (18.6 MB), cached under `scratch/hf-cache`.
- `HF_TOKEN` is read from `.env` when present and never written to the output files.

```bash
pixi run python lab/datasets/sample.py --mode 100
pixi run python lab/datasets/sample.py --mode 1000 --exclude-holdout
pixi run python lab/datasets/sample.py --mode 10000
```

## Bootstrap sample

```bash
pixi run python mds/datasets-dl-sample.py --per-class 50
```

- Output: `datasets/high_risk_bootstrap.csv`, 200 rows.
- Useful for a quick smoke test without the full build.
- Also local and gitignored.
