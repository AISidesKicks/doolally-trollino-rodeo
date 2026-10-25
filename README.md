# Don't feed the trolls

A durable high-risk text classification lab with two small local models, a live GUI, and a crash-recovery demo.

**Live site:** https://doolally.trollino.rodeo

**Source:** https://github.com/AISidesKicks/doolally-trollino-rodeo

![The DLLY lab dashboard](docs/assets/lab-dashboard.webp)

Trollino posts the bait. Doolally stamps the ban. Both trolls read the same short texts, and SQLite keeps the score even when Trollino pulls the plug.

This is an educational project about the real cost of AI infrastructure: accuracy, latency, memory and recovery. It is not a production moderation system.

## What it shows

- How far small local models get on a narrow four-class task.
- How much faster a 3B decision model is than an 8B chat model.
- How a durable worker recovers after a hard SIGKILL with no duplicate work.
- How one retry changes the cost and the result.
- Which parts of the stack need a GPU and which do not.

## Measured result

Mode 100, seed 42, same stratified sample, retry 1, zero provider errors:

| Model | Role | Accuracy | Median latency | Relative speed |
| --- | --- | --- | --- | --- |
| LFM2.5-8B-A1B | Doolally, moderator | 80-85% | 594 ms | 1x |
| d1-3B | Trollino, author | 85% | 26 ms | about 22x faster |
| LFM2.5-8B-A1B FT | optional speed variant | 65% | 110 ms | about 5x faster |

The 3B decision model matched or beat the 8B chat model on this narrow task, using one fifth of the disk and answering in milliseconds. The optional fine-tune was faster but less accurate, so it is not the default.

Full notes, including the parser mistakes behind the first bad run: [mds/benchmarks.md](mds/benchmarks.md).

## Architecture

```
browser GUI (built into gui/)
        |
        v
Node 24 worker  --  durable runner  --  SQLite (runs, tasks, attempts, batches)
        |
        +--> llama.cpp server (LFM2.5-8B-A1B)
        +--> llama.cpp server (d1-3B)
        +--> optional llama.cpp server (LFM2.5-8B-A1B FT)
        |
        +--> Arize Phoenix (one span per committed batch)

Python flow (pixi dlly)  --  dataset sampling and preparation
```

- **Node 24** is required for built-in `node:sqlite`.
- **Durable runner** commits a batch before the next one starts and resumes from the first uncommitted batch.
- **GUI** is plain HTML, CSS and JS. Build output goes to `gui/`; source is in `src/gui/`.
- **Docker** runs the models, Phoenix and the lab. All resources use the `dlly-` prefix.
- **Python** in pixi prepares the dataset. It does not run the live demo.

## Quick start

Prerequisites: Node 24, pixi, Docker with the NVIDIA container runtime, and about 8 GB of free disk for the default models.

```bash
# 1. dataset is committed, models are not
pixi run python lab/models/download.py

# 2. build and start the stack
docker compose -f docker/compose.yaml up -d --build

# 3. open the dashboard
open http://127.0.0.1:3030
```

Phoenix is at http://127.0.0.1:6006. The worker sends one span per committed batch.

The mock provider runs without Docker, models or a GPU:

```bash
npm run build:gui
npm run server
# use provider "Mock" in the dashboard
```

More Docker detail: [docker/README.md](docker/README.md).

## Play modes

| Mode | Tasks | Sampling |
| --- | --- | --- |
| `100` | 100 | 25 rows per class, stratified hash sample |
| `1000` | 1,000 | 250 rows per class |
| `10000` | 10,000 | the whole pool, shuffled |

The canonical file is globally shuffled with a SHA-256 order key. Play batches are never the first N rows. The sampler orders each class by a stable hash and mixes the classes again. See [lab/datasets/sample.py](lab/datasets/sample.py).

Add `--exclude-holdout` for a clean benchmark batch. By default the demo includes the full pool.

## Recovery proof

- Kill after batch 2: 6 tasks committed, 94 pending.
- Resume from SQLite.
- Final state: 100 tasks, 34 committed batches, exactly 200 attempts for two models.
- Zero duplicate `(run_id, task_position, model)` rows.
- The GUI shows the durable batch, the pending count and a real resume button.

The batch commit is the unit of durability. If a batch is interrupted before it is marked done, the worker reuses the attempts that were already committed.

## Models

| Key | Model | Size | Role |
| --- | --- | --- | --- |
| `lfm` | LFM2.5-8B-A1B Q4_K_M | 5.16 GB | chat classifier, reasoning capped at 128 tokens |
| `d1` | d1-3B Q4_K_M | 1.67 GB | decision model, `/v1/systemone` |
| `lfm-ft` | LFM2.5-8B-A1B FT Q4KXL | 6.17 GB | optional instruction-tuned variant |

Weights live in `models/gguf/` and are gitignored. Sizes, hashes and licenses: [models/README.md](models/README.md).

The optional fine-tune is called **LFM2.5-8B-A1B FT** in this repo. Its upstream repo name includes the training framework, which is also an agent harness name, so the app does not use it.

## Dataset

- 10,000 rows, 2,500 per class.
- 8 experiment folds of 1,000 rows plus a 2,000-row holdout.
- Text capped at 2,000 characters, about 500 tokens.
- Sources: 8,230 Yahoo Answers rows and 1,770 AG News rows.
- Labels are heuristics, not gold annotations.

The canonical JSONL, manifest and source metadata are committed in [datasets/](datasets/). Provenance, licenses and caveats: [datasets/README.md](datasets/README.md) and [datasets/SOURCES.json](datasets/SOURCES.json).

## Deep dives

- [mds/benchmarks.md](mds/benchmarks.md) - measured results, parser fixes and the optional fine-tune.
- [mds/datasets.md](mds/datasets.md) - source datasets, labels and license notes.
- [mds/durable-execution.md](mds/durable-execution.md) - Pi Durable, crash recovery and replay references.
- [INTENT.md](INTENT.md) - project intent, play modes, architecture and status.
- [lab/datasets/README.md](lab/datasets/README.md) - builder, folds, sampling and verification.

## Repository layout

| Path | What it is |
| --- | --- |
| `src/` | Node worker, server, providers, tracing and GUI source |
| `src/gui/` | plain HTML, CSS and JS dashboard |
| `gui/` | GUI build output, gitignored |
| `docs/` | static GitHub Pages site for https://doolally.trollino.rodeo |
| `lab/` | dataset builder, sampler and model downloader |
| `mds/` | deep dives and reference lists |
| `datasets/` | committed 10k pool, manifest and provenance |
| `models/` | local GGUF weights, tracked README and placeholders |
| `docker/` | compose stack and Node image |
| `tests/` | Python dataset tests and Node worker tests |
| `scratch/` | local logs, screenshots and artefacts, gitignored |

## Tests

```bash
pixi run python -m unittest discover -s tests
npm test
```

Current coverage:

- Python: dataset shape, folds, sampling balance, source provenance.
- Node: Python parity for mode 100, 1,000 and 10,000 selection, mock runs, one retry, kill and resume with no duplicate attempts, API smoke test, OTLP span export.

## Commands

```bash
# worker, direct
npm run worker -- run --mode 100 --provider mock
npm run worker -- run --mode 100 --provider llama --models lfm,d1 --retries 1

# status and history
npm run worker -- list
npm run worker -- status --run-id run-xxxxxxxx

# GUI
npm run build:gui
npm run server

# dataset batch
pixi run python lab/datasets/sample.py --mode 1000 --exclude-holdout
```

## Secrets

`.env` is local only and gitignored. `HF_TOKEN` is read-only and is never written to datasets, logs or manifests. See [.env.example](.env.example).

## License

MIT. See [LICENSE](LICENSE).
