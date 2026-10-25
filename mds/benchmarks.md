# Benchmark notes

These are lab notes, not a leaderboard. The labels are heuristics and the sample is small.

## Setup

- Dataset: `datasets/high-risk-10k.jsonl`, mode 100, seed 42, 25 rows per class.
- Models: LFM2.5-8B-A1B Q4_K_M, d1-3B Q4_K_M, optional LFM2.5-8B-A1B FT Q4KXL.
- Runtime: llama.cpp server 0.7.0-dev (build 11870), Docker, RTX 4070 12 GB.
- Batch size 3, retry 1, temperature 0.1 for LFM.
- LFM reasoning capped at 128 tokens with `--reasoning-budget 128`.
- d1 is asked one `choice` question at `/v1/systemone`; it returns calibrated probabilities.
- Accuracy is exact match against the dataset label. Errors count as incorrect.

## Results

| Run | Model set | LFM accuracy | LFM median | d1 accuracy | d1 median | Disagreements |
| --- | --- | --- | --- | --- | --- | --- |
| Host, stock LFM | `lfm,d1` | 85% | 594 ms | 85% | 26 ms | 11 |
| Container, stock LFM | `lfm,d1` | 80% | 594 ms | 85% | 26 ms | 13 |
| Optional FT | `lfm-ft,d1` | 65% | 110 ms | 85% | 26 ms | 36 |

LFM varies between runs. Both stock-LFM runs used the same play sample and the same sampling settings, but llama.cpp does not promise bit-identical sampling across processes. Report the range, not a single decimal.

## What went wrong first

The first real LFM run showed 36% accuracy and 39 errors. The model was not broken. It returned labels like `Political & Elections`, `Political Campaigns` and `Business & Finance`. The parser only accepted the exact four strings, so those rows were recorded as errors.

Fixes:

1. Normalize near-miss labels by head noun: `politic*`, `medical*` or `health*`, `legal*` or `regulat*`, `financial*`, `finance*`, `crypto*`, `business*`.
2. Add a JSON schema with the four labels as an enum, so the model cannot invent a fifth label.
3. Keep one retry per model and task for transport and parser failures.
4. Cap LFM reasoning so the JSON actually fits in the token budget. A 120-token limit was consumed by chain-of-thought and produced an empty `content`.

After those fixes, stock LFM reached 80-85% with zero errors. The lesson for the blog: a mediocre score can be a parser problem, not a model problem. Measure errors separately from wrong labels.

## Optional fine-tune

The optional LFM2.5-8B-A1B FT checkpoint is instruction-tuned and answers with JSON directly, without a reasoning trace. It was 5x faster than stock LFM but 15 to 20 points less accurate on this sample. It is useful as a speed and instruction-following comparison, not as the default.

The repo name of the checkpoint includes the name of a training framework that is also an agent harness. This project calls the local file and the display name `LFM2.5-8B-A1B FT` to avoid that confusion.

## Recovery check

- Kill after batch 1 with 3 tasks committed.
- Resume from SQLite.
- Final state: 100 tasks, 34 committed batches, exactly 200 attempts for two models.
- No duplicate `(run_id, task_position, model)` rows.

The worker reuses attempts that were already committed, even if a batch was interrupted before it was marked done. The batch commit is the unit of durability.

## Reproduce

```bash
# default models
pixi run python lab/models/download.py
docker compose -f docker/compose.yaml up -d --build

# real 100-task run, no pause
npm run worker -- run --mode 100 --provider llama --models lfm,d1 --batch-size 3 --retries 1

# the GUI uses the container database
open http://127.0.0.1:3030
```

For a clean benchmark batch, add `--exclude-holdout`. The default demo includes the holdout on purpose, so the live queue has the full pool.
