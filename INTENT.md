# High-Risk Topical Context Classification - project intent

## What we are building

An educational, watchable lab that classifies short texts into four "high-risk topical context" classes with two small local models, then shows what happens when the worker is killed mid-run.

The point is not a perfect classifier. The point is to show:

- how far small local models get on a narrow classification task,
- how much faster the smaller model is, in milliseconds, seconds and percent,
- how a durable workflow recovers after a hard kill,
- which parts of the stack actually need money and which do not.

Measured notes and the parser mistakes behind the first run are in [mds/benchmarks.md](mds/benchmarks.md).

## Models

| Role | Model | Size |
| --- | --- | --- |
| Chat classifier | [LiquidAI/LFM2.5-8B-A1B-GGUF](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF) | 4-bit Q4_K_M, 5.16 GB |
| Decision model | [LiquidAI/d1-3B-GGUF](https://huggingface.co/LiquidAI/d1-3B-GGUF) | 4-bit Q4_K_M, 1.67 GB |
| Optional variant | [LFM2.5-8B-A1B FT checkpoint](https://huggingface.co/jakeatx/LFM-2.5-8B-1B-hermes-ft) | 4-bit Q4KXL, 6.17 GB |

The optional variant is an instruction-tuned LFM2.5 checkpoint. It is referred to as **LFM2.5-8B-A1B FT** in this repo, not by the training framework name, because that name also describes an agent harness and gets confusing fast.

All models are served by llama.cpp in Docker (server 0.7.0-dev, build 11870) and compared on the same tasks.

## Measured baseline

Mode 100, seed 42, same stratified sample, retry 1, zero provider errors:

| Model | Accuracy | Median latency | Relative speed |
| --- | --- | --- | --- |
| LFM2.5-8B-A1B, reasoning capped at 128 tokens | 80-85% | 594 ms | 1x |
| d1-3B, one forward pass | 85% | 26 ms | 22x faster |
| LFM2.5-8B-A1B FT, optional | 65% | 110 ms | 5x faster |

The 3B decision model matched or beat the 8B chat model on this narrow task at a fraction of the latency and disk. LFM scored 85% in a host run and 80% in the container run, so report the range rather than a single number. LFM sampling is not fully deterministic, even with the same play sample. The optional fine-tune was faster than stock LFM but 15 to 20 points less accurate, so it is not the default. These are heuristic labels, not gold annotations.

## Target classes

Classification of "High-Risk Topical Context". These are not inherently policy violations, but they flag the message as requiring specialized handling or contextual awareness.

- **Politics & Elections**: political campaigns, candidates, voting procedures, and public policy.
- **Medical & Health**: medical advice, symptoms, pharmaceuticals, or mental health discussions.
- **Legal & Regulatory**: court cases, compliance matters, contracts, or law enforcement mentions.
- **Financial & Crypto**: investment advice, stock tickers, banking details, or cryptocurrency.

## Demo flow (semi-show mode)

The demo is meant to be watched, not just benchmarked. A batch is small enough to read on screen, and there is a deliberate pause before the next one.

### Play modes

| Mode | Tasks | Use |
| --- | --- | --- |
| `pilot` | 100 | development and live demo |
| `short` | 1,000 | full run and benchmark |
| `long` | 10,000 | full pool stress run |

### Per run

1. **Build the run list.** Sample tasks from the canonical pool with a stratified hash sample, mix the classes, and persist the ordered list in SQLite. Every run gets a different order; a recovery continues the same list.
2. **Process in batches of 3.** Send the same 3 texts to both models. Record the label, latency and timing per model. An invalid label gets one retry, so a bad batch can take twice as long.
3. **Show the comparison.** After each batch, display milliseconds, seconds and how much faster the smaller model was in percent.
4. **Pause.** Wait a few seconds so a human can read the numbers. This pause is also the random kill window.
5. **Kill window.** Trollino may SIGKILL the worker at a batch boundary. Killing between batches keeps the demo about restart recovery, not about corrupting SQLite mid-write.
6. **Recovery screen.** If killed, show a funny "Trollino pulled the plug" screen with tasks done, tasks pending and the last committed batch.
7. **Replay and continue.** The GUI shows the recovered batches from SQLite, then continues with the next 3 tasks.
8. **Finish.** Show totals per model: tasks, mean and median latency, speed difference, and label disagreements.

## Dataset plan

Sources shortlisted in [mds/datasets.md](mds/datasets.md):

- [Yahoo Answers 10 Categories](https://huggingface.co/datasets/yassiracharki/Yahoo_Answers_10_categories_for_NLP) - Health, Business & Finance, Politics & Government.
- [AG News](https://huggingface.co/datasets/fancyzhx/ag_news) - Business and World news.
- [DeepPavlov Topics](https://deeppavlov.ai/datasets/topics) - 33 topics, 4.2M samples, for later scale-up.
- [Reuters-21578](https://huggingface.co/datasets/ucirvine/reuters21578) - business, trading and crypto vocabulary.

The canonical pool is built by [lab/datasets/build.py](lab/datasets/build.py); design notes are in [lab/datasets/README.md](lab/datasets/README.md).

Rules:

- **Canonical pool.** 10,000 rows, 2,500 per class.
- **Folds.** 8 x 1,000 rows (250 per class) plus 2,000 holdout rows (500 per class). Pilot 100, short 1,000, long 10,000.
- **Short texts.** d1-3B context is 32,768 tokens, LFM2.5 is 128,000. Cap text at 2,000 characters (about 500 tokens). The current build has p50 444 chars, p99 1,984 chars and max 500 estimated tokens.
- **Mixed sources.** Yahoo Answers test plus AG News train. The current build has 8,230 Yahoo rows and 1,770 AG News rows. Source repos, files and licenses are in [datasets/SOURCES.json](datasets/SOURCES.json).
- **Heuristics, not gold labels.** Topic anchors for Medical, Politics and Financial; legal scoring for Legal. Yahoo labels are noisy and Legal is keyword-filtered. Keep the caveat visible.
- **No first-N bias.** The canonical file is globally shuffled with a SHA-256 order key. Play batches are stratified by class with [lab/datasets/sample.py](lab/datasets/sample.py): 25 per class for 100 tasks, 250 per class for 1,000 tasks, all rows for 10,000 tasks.
- **Dataset is committed.** The canonical JSONL and manifest are tracked so the lab runs without a rebuild. The CSV view and play batches stay local. Nothing in `datasets/` is published to GitHub Pages.

Commands:

```bash
# full 10k pool
pixi run python lab/datasets/build.py --per-class 2500

# reuse raw candidates while tuning
pixi run python lab/datasets/build.py --per-class 2500 --reuse-raw

# 200-row smoke pool
pixi run python lab/datasets/build.py --target 200 --name high-risk-200

# deterministic play batches
pixi run python lab/datasets/sample.py --mode 100
pixi run python lab/datasets/sample.py --mode 1000 --exclude-holdout
pixi run python lab/datasets/sample.py --mode 10000
```

Outputs: `datasets/high-risk-10k.jsonl` (canonical, tracked), `.manifest.json` (stats, tracked), `SOURCES.json` (provenance and licenses, tracked) and `.csv` (human view, local only). The builder caches downloads under `scratch/hf-cache` and never pulls the 746 MB Yahoo train split.

## Architecture

```
browser GUI (built into gui/)
        |
        v
Node 24 worker  --  durable runner  --  SQLite (state, task list, checkpoints)
        |
        +--> llama.cpp server (LFM2.5-8B-A1B)
        +--> llama.cpp server (d1-3B)
        +--> optional llama.cpp server (LFM2.5-8B-A1B FT)
        |
        +--> Arize Phoenix (one span per committed batch)

Python flow (pixi dlly)  --  dataset sampling and preparation
```

- **Node 24 worker** runs the classification batches and the durable workflow. Node 24 is required for built-in `node:sqlite`.
- **Durable runner** commits a batch to SQLite before the next batch starts, and resumes from the first uncommitted batch after a restart. Pi Durable is the design inspiration; this lab uses a small local runner so the recovery is visible in the code.
- **SQLite** is the single source of truth for the task list, labels, attempts and recovery state.
- **GUI** is a separate app; its build output goes to `gui/`. It is a plain HTML, CSS and JS build with no framework.
- **Docker** runs the models, Phoenix and the lab service. All resources use the `dlly-` prefix.
- **Phoenix** shows one span per committed batch. The worker sends OTLP protobuf to `PHOENIX_URL`, with no extra npm dependency. It is enabled in the compose lab service.
- **Python** (pixi `dlly`) prepares datasets. It does not run the live demo.

## Repository layout

| Path | Role | State |
| --- | --- | --- |
| `docs/` | static GitHub Pages site only (HTML pages and images) | project page, troll art, `CNAME` |
| `gui/` | build output directory for the GUI, gitignored | generated by `npm run build:gui` |
| `src/` | Node 24 worker, server, providers, GUI source | durable runner, llama and mock providers |
| `src/gui/` | GUI source, built into `gui/` | plain HTML, CSS and JS |
| `src/tracing.js` | OTLP protobuf exporter for Phoenix | one span per committed batch |
| `docker/` | container definitions, `dlly-` prefix | compose stack and Node image |
| `lab/` | hands-on plan and experiments | dataset builder, sampler, model downloader |
| `mds/` | deep dives and reference lists | dataset notes, durable research |
| `datasets/` | curated short-topic datasets | 10k canonical pool + sources, committed |
| `models/gguf/` | local GGUF weights, gitignored except placeholders | 2 default models, 1 optional |
| `tests/` | Python dataset tests and Node worker tests | 12 Python, 15 Node |
| `scratch/` | logs, HF cache and crash artifacts, gitignored except `.gitkeep` | ready |

## Plan and status

- [x] Pixi environment `dlly` with Python 3.12, Node 24.22.1, `huggingface_hub` and `pyarrow`.
- [x] Verify `node:sqlite` and local `npx` installs.
- [x] Research durable execution examples: [mds/durable-execution.md](mds/durable-execution.md).
- [x] Record the static-only rule for `docs/` and the `gui/` build directory.
- [x] Dataset: 10,000 rows, 2,500 per class, 8 folds plus 2,000 holdout rows, committed with source provenance.
- [x] SQLite schema: runs, tasks, attempts, batches, labels, timings and retries.
- [x] Node durable worker with 100, 1,000 and 10,000 play modes.
- [x] llama.cpp Docker services for LFM2.5-8B-A1B and d1-3B, with an optional fine-tune profile.
- [x] GUI: batch timing, live scoreboard, random kill, recovery screen and resume.
- [x] Trollino kill path and crash-recovery tests with zero duplicate attempts.
- [x] One retry cycle for invalid labels, recorded per attempt.
- [x] Node tests for sampling parity, mock runs, retries and API recovery.
- [x] Static project page in `docs/index.html`.
- [x] Arize Phoenix tracing: one OTLP protobuf span per committed batch, with run, batch, error and retry attributes.

## Infrastructure

Docker, all resources prefixed `dlly-`:

- `dlly-llama-lfm`: LFM2.5-8B-A1B on port 8081
- `dlly-llama-d1`: d1-3B on port 8082
- `dlly-llama-lfm-ft`: optional LFM fine-tune on port 8083, profile `lfm-ft`
- `dlly-phoenix`: Arize Phoenix on port 6006, OTLP on 4317
- `dlly-lab`: Node 24 server and worker on port 3030
- network `dlly-net`, volumes `dlly-lab-data` and `dlly-phoenix-data`

```bash
# default models and lab
docker compose -f docker/compose.yaml up -d --build

# optional fine-tune instead of stock LFM (stop lfm first on a 12 GB GPU)
docker compose -f docker/compose.yaml stop llama-lfm
docker compose -f docker/compose.yaml --profile lfm-ft up -d llama-lfm-ft

# local GUI without Docker
npm run build:gui
npm run server
```

Python tooling runs in the pixi `dlly` environment. Node packages are installed locally with `npx`/`npm`, never globally.

## Inspirations

- [alejandro-ao/pi-durable-demo](https://github.com/alejandro-ao/pi-durable-demo) - direct tutorial inspiration: Node 24, SQLite, llama.cpp, restart recovery.
- [earendil-works/pi - packages/durable](https://github.com/earendil-works/pi/tree/main/packages/durable) - durable harness and design spec.
- [vercel-labs/durable-harness](https://github.com/vercel-labs/durable-harness) - durable adapters for coding agents.
- More links: [mds/durable-execution.md](mds/durable-execution.md).
