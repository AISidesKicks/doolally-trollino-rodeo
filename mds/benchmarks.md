# Benchmark notes

These are lab notes, not a leaderboard. The labels are heuristics and the samples are 100, 1,000 and 10,000 tasks.

## Setup

- Dataset: `datasets/high-risk-10k.jsonl`.
- Mode 100: seed 42, 25 rows per class, full pool.
- Mode 1,000: seed 42, 250 rows per class, holdout excluded.
- Models: LFM2.5-8B-A1B Q4_K_M, d1-3B Q4_K_M, optional LFM2.5-8B-A1B FT Q4KXL.
- Runtime: llama.cpp server 0.7.0-dev (build 11870), Docker, RTX 4070 12 GB.
- Batch size 3, retry 1, pause 0 for the 1,000 benchmark.
- LFM temperature 0.1, reasoning capped at 128 tokens with `--reasoning-budget 128`.
- d1 is asked one `choice` question at `/v1/systemone`; it returns calibrated probabilities.
- Accuracy is exact match against the dataset label. Errors count as incorrect.

## Results

| Run | Model set | LFM accuracy | LFM median | d1 accuracy | d1 median | Disagreements |
| --- | --- | --- | --- | --- | --- | --- |
| 100 tasks, clean | `lfm,d1` | 81.0% | 593 ms | 85.0% | 27 ms | 13 |
| 1,000 tasks, clean | `lfm,d1` | 77.8% | 606 ms | 81.8% | 27 ms | 152 |
| 10,000 tasks, full pool | `lfm,d1` | 78.9% | 511 ms | 81.9% | 24 ms | 1,432 |
| 100 tasks, host, full pool | `lfm,d1` | 85% | 594 ms | 85% | 26 ms | 11 |
| 100 tasks, container, full pool | `lfm,d1` | 80% | 594 ms | 85% | 26 ms | 13 |
| 100 tasks, optional FT | `lfm-ft,d1` | 65% | 110 ms | 85% | 26 ms | 36 |

The 100 and 1,000 clean runs exclude the holdout. The 10,000 run is the full pool and includes it by design, because the non-holdout folds have only 2,000 rows per class.

LFM varies between runs. The 100-task pilots and the larger runs use different samples, so do not compare decimals too closely. The clean 1,000 and 10,000 runs agree on the main pattern: d1 leads by about 3 to 4 points and is about 22x faster.

## Three-size comparison

| Sample | Batches | Attempts | Active time | Rate | d1 lead |
| --- | --- | --- | --- | --- | --- |
| 100 clean | 34 | 200 | 1.0 min | 1.61 tasks/s | 4.0 points |
| 1,000 clean | 334 | 2,000 | 10.3 min | 1.62 tasks/s | 4.0 points |
| 10,000 full | 3,334 | 20,000 | 91.2 min | 1.83 tasks/s | 3.0 points |

All three runs had zero provider errors and zero retries. d1 was about 22x faster at every size, which is about 95% less latency.

## 1,000-task run

Run `run-960a2486` on the container stack:

- 1,000 tasks, 334 batches, 2,000 attempts.
- 10.3 active minutes, 1.62 tasks per second.
- Zero provider errors, zero retries used.
- 152 disagreements (15.2%).
- LFM 778 / 1,000 correct, 77.8%.
- d1 818 / 1,000 correct, 81.8%.
- d1 was 4.0 points more accurate and about 22x faster.

Latency:

| Model | Mean | Median | p95 | Min | Max |
| --- | --- | --- | --- | --- | --- |
| LFM2.5-8B-A1B | 586 ms | 606 ms | 678 ms | 415 ms | 716 ms |
| d1-3B | 31 ms | 27 ms | 55 ms | 17 ms | 72 ms |

### Per-class F1

| Class | LFM precision | LFM recall | LFM F1 | d1 precision | d1 recall | d1 F1 |
| --- | --- | --- | --- | --- | --- | --- |
| Politics & Elections | 76.1% | 68.8% | 72.3% | 78.1% | 78.4% | 78.2% |
| Medical & Health | 88.4% | 98.0% | 93.0% | 87.3% | 98.8% | 92.7% |
| Legal & Regulatory | 60.5% | 70.4% | 65.1% | 72.7% | 66.0% | 69.2% |
| Financial & Crypto | 89.8% | 74.0% | 81.1% | 87.9% | 84.0% | 85.9% |

### Where the errors go

LFM predicted Legal 291 times for 250 expected Legal rows. It pulled 62 Politics rows into Legal and sent 44 Legal rows to Politics. It also sent 50 Financial rows to Legal. That is an over-strong Legal prior, not a random error.

d1 also confuses Legal and Politics, but more evenly: 44 Politics to Legal and 42 Legal to Politics. It adds 23 Legal to Medical and 20 Legal to Financial. Its predicted counts are closer to the 250-per-class target: Medical 283, Politics 251, Financial 239, Legal 227.

Medical is the easiest class for both models, with about 98% recall. Legal is the hardest for both. The dataset's Legal label is keyword-filtered, so some of these errors may be label noise rather than model failure.

### What it means

The 1,000 and 10,000 runs are stronger evidence than the 100-task demo:

- d1 still matches or beats LFM on accuracy while being about 22x faster.
- LFM's extra parameters do not buy accuracy on this narrow topic task.
- Legal and Politics are the boundary that needs better data, not a longer prompt.
- Zero errors and zero retries shows that the schema and parser fixes held at scale.
- Even 10,000 tasks is not a production benchmark. Use the full non-holdout pool and a human-labeled sample before making broader claims.

## 10,000-task run

Run `run-994795b2` on the container stack:

- Full pool, including the holdout. 2,500 rows per class.
- 10,000 tasks, 3,334 batches, 20,000 attempts.
- 91.2 active minutes, 1.83 tasks per second.
- Zero provider errors, zero retries used.
- 1,432 disagreements (14.3%).
- LFM 7,885 / 10,000 correct, 78.9%.
- d1 8,188 / 10,000 correct, 81.9%.
- d1 was 3.0 points more accurate and about 22x faster.

Latency:

| Model | Mean | Median | p95 | Min | Max |
| --- | --- | --- | --- | --- | --- |
| LFM2.5-8B-A1B | 519 ms | 511 ms | 605 ms | 401 ms | 708 ms |
| d1-3B | 27 ms | 24 ms | 51 ms | 15 ms | 75 ms |

The LFM median was lower on the 10,000 run than on the 1,000 run (511 ms vs 606 ms). Treat that as an observation, not a claim: sustained load can change GPU clocks, and the prompt mix is different because the full pool includes the holdout.

### Per-class F1, 10,000 tasks

| Class | LFM precision | LFM recall | LFM F1 | d1 precision | d1 recall | d1 F1 |
| --- | --- | --- | --- | --- | --- | --- |
| Politics & Elections | 75.6% | 72.9% | 74.2% | 77.3% | 81.2% | 79.2% |
| Medical & Health | 89.3% | 97.7% | 93.3% | 87.3% | 99.1% | 92.8% |
| Legal & Regulatory | 62.4% | 70.6% | 66.2% | 73.3% | 66.4% | 69.7% |
| Financial & Crypto | 91.5% | 74.2% | 82.0% | 88.9% | 80.7% | 84.6% |

### Confusion, 10,000 tasks

LFM predicted Legal 2,829 times for 2,500 expected Legal rows. The largest errors:

- Politics expected, Legal predicted: 559.
- Legal expected, Politics predicted: 486.
- Financial expected, Legal predicted: 468.
- Legal expected, Medical predicted: 168.
- Financial expected, Politics predicted: 93.

d1 predicted Legal 2,266 times and kept the classes closer to their true counts:

- Politics expected, Legal predicted: 383.
- Legal expected, Politics predicted: 448.
- Financial expected, Legal predicted: 214.
- Legal expected, Medical predicted: 199.
- Legal expected, Financial predicted: 192.
- Financial expected, Politics predicted: 139.
- Financial expected, Medical predicted: 129.

The error pattern is stable across 1,000 and 10,000 tasks. Legal is a sink for Politics and Financial text, and d1 handles that boundary better. This is a data and label-definition problem, not a prompt-length problem.

## 100-task pilot

The clean 100-task run scored LFM 81.0% and d1 85.0%, with 13 disagreements, 34 batches and 1.0 active minute. The optional LFM2.5-8B-A1B FT scored 65% at 110 ms on the full-pool pilot.

Use the 100 run for iteration and the live demo. Use the 1,000 and 10,000 runs for claims about accuracy.

## What went wrong first

The first real LFM run showed 36% accuracy and 39 errors. The model was not broken. It returned labels like `Political & Elections`, `Political Campaigns` and `Business & Finance`. The parser only accepted the exact four strings, so those rows were recorded as errors.

Fixes:

1. Normalize near-miss labels by head noun: `politic*`, `medical*` or `health*`, `legal*` or `regulat*`, `financial*`, `finance*`, `crypto*`, `business*`.
2. Add a JSON schema with the four labels as an enum, so the model cannot invent a fifth label.
3. Keep one retry per model and task for transport and parser failures.
4. Cap LFM reasoning so the JSON actually fits in the token budget. A 120-token limit was consumed by chain-of-thought and produced an empty `content`.

After those fixes, stock LFM reached 81.0% on the clean 100 run, 77.8% on 1,000 and 78.9% on 10,000, with zero errors in all three. The lesson for the blog: a mediocre score can be a parser problem, not a model problem. Measure errors separately from wrong labels.

## Optional fine-tune

The optional LFM2.5-8B-A1B FT checkpoint is instruction-tuned and answers with JSON directly, without a reasoning trace. It was 5x faster than stock LFM but 15 to 20 points less accurate on the 100-task sample. It is useful as a speed and instruction-following comparison, not as the default.

The repo name of the checkpoint includes the name of a training framework that is also an agent harness. This project calls the local file and the display name `LFM2.5-8B-A1B FT` to avoid that confusion.

## Recovery check

- Kill after batch 1 with 3 tasks committed.
- Resume from SQLite.
- Final state: 100 tasks, 34 committed batches, exactly 200 attempts for two models.
- No duplicate `(run_id, task_position, model)` rows.

The worker reuses attempts that were already committed, even if a batch was interrupted before it was marked done. The batch commit is the unit of durability.

## Running the 1,000 mode

Through the dashboard:

1. Choose play mode **1,000**.
2. Choose provider **llama.cpp**.
3. Set batch size **3** and pause **0** for a benchmark, or **1000-2500** to watch it.
4. Tick **Keep the holdout out**.
5. Keep **Retry a failed label once** on.
6. Press **Send the trolls**.

Through the API:

```bash
curl -sS -X POST http://127.0.0.1:3030/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":1000,"provider":"llama","batchSize":3,"pauseMs":0,"retries":1,"excludeHoldout":true}'

# poll the returned run id
curl -sS http://127.0.0.1:3030/api/runs/run-xxxxxxxx
```

On the RTX 4070 this run took 10.3 active minutes. With a 1,000 ms pause it takes about 16 minutes. With a 2,500 ms pause it takes about 24 minutes.

## Running the 10,000 mode

The 10,000 mode uses the full pool, including the holdout. The non-holdout folds only have 2,000 rows per class, so a clean 10,000 sample is not possible.

1. Choose **10,000**.
2. Choose **llama.cpp**.
3. Set batch size **3** and pause **0**.
4. Leave **Keep the holdout out** unticked.
5. Keep **Retry a failed label once** on.
6. Press **Send the trolls**.

```bash
curl -sS -X POST http://127.0.0.1:3030/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":10000,"provider":"llama","batchSize":3,"pauseMs":0,"retries":1,"excludeHoldout":false}'
```

This run has 10,000 tasks and 3,334 batches. It took 91.2 active minutes on the RTX 4070 with stock LFM. It is a stress run, not a quick demo.

## Reproduce

```bash
# default models
pixi run python lab/models/download.py
docker compose -f docker/compose.yaml up -d --build

# real 100-task run, no pause
npm run worker -- run --mode 100 --provider llama --models lfm,d1 --batch-size 3 --retries 1

# real 1,000-task clean benchmark, no pause
npm run worker -- run --mode 1000 --provider llama --models lfm,d1 --batch-size 3 --retries 1 --exclude-holdout

# real 10,000-task full-pool stress run, no pause
npm run worker -- run --mode 10000 --provider llama --models lfm,d1 --batch-size 3 --retries 1

# the GUI uses the container database
open http://127.0.0.1:3030
```

For a clean benchmark batch, add `--exclude-holdout`. The default demo includes the holdout on purpose, so the live queue has the full pool. The 1,000 benchmark in this note used `--exclude-holdout`.
