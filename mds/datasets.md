# Dataset notes

Shortlist of short-topic datasets for the four high-risk topical context classes. The bootstrap downloader is [datasets-dl-sample.py](datasets-dl-sample.py).

## Yahoo Answers 10 Categories

- Hugging Face: https://huggingface.co/datasets/yassiracharki/Yahoo_Answers_10_categories_for_NLP
- Size: 1.4M train rows, 60k test rows. The test split is enough for the bootstrap.
- Columns: `class_index`, `question_title`, `question_content`, `best_answer`.
- Relevant labels (1-based `class_index`):
  - `3` = Health -> Medical & Health
  - `7` = Business & Finance -> Financial & Crypto
  - `10` = Politics & Government -> Politics & Elections
- Labels are noisy. Some rows are clearly mislabeled, so keep the source label visible and do not over-tune on the bootstrap sample.

## AG News

- Hugging Face: https://huggingface.co/datasets/fancyzhx/ag_news
- Size: 120k train rows, 7.6k test rows of short news headlines.
- Labels: `0` World, `1` Sports, `2` Business, `3` Sci/Tech.
- Used for Financial & Crypto and, through the legal keyword filter, Legal & Regulatory.

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

## Bootstrap output

```bash
pixi run python mds/datasets-dl-sample.py --per-class 50
```

- Output: `datasets/high_risk_bootstrap.csv` with columns `text,label,source`.
- Current sample: 50 rows per class, 200 total (180 Yahoo Answers, 20 AG News).
- The file is gitignored and stays local. The script caches downloads under `scratch/hf-cache`.
- No full dataset download: Yahoo uses `test.csv` (32 MB), AG News uses the test parquet (1.2 MB).
