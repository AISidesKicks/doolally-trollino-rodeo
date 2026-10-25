# High-Risk Topical Context Classification - project intent

## What we are building

An educational, watchable lab that classifies short texts into four "high-risk topical context" classes with two small local models, then shows what happens when the worker is killed mid-run.

The point is not a perfect classifier. The point is to show:

- how far small local models get on a narrow classification task,
- how much faster the smaller model is, in milliseconds, seconds and percent,
- how a durable workflow recovers after a hard kill,
- which parts of the stack actually need money and which do not.

## Models

| Role | Model | Size |
| --- | --- | --- |
| LLM | [LiquidAI/LFM2.5-8B-A1B-GGUF](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF) | 4-bit Q4_K_M, 5.16 GB |
| SystemOne | [LiquidAI/d1-3B-GGUF](https://huggingface.co/LiquidAI/d1-3B-GGUF) | 4-bit Q4_K_M, 1.67 GB |

Both models are served by llama.cpp 7.x in Docker and are compared on the same tasks.

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
2. **Process in batches of 3.** Send the same 3 texts to both models. Record the label, latency and timing per model.
3. **Show the comparison.** After each batch, display milliseconds, seconds and how much faster the smaller model was in percent.
4. **Pause.** Wait a few seconds so a human can read the numbers. This pause is also the random kill window.
5. **Kill window.** Trollino may SIGKILL the worker at a batch boundary. Killing between batches keeps the demo about restart recovery, not about corrupting SQLite mid-write.
6. **Recovery screen.** If killed, show a funny "Trollino killed dlly" screen with tasks done, tasks pending, the last committed batch and the replay time.
7. **Replay and continue.** The GUI replays recovered batches with a delay, then continues with the next 3 tasks.
8. **Finish.** Show totals per model: tasks, mean and median latency, percent difference, and label disagreements.

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
Node 24 worker  --  Pi Durable  --  SQLite (state, task list, checkpoints)
        |
        +--> llama.cpp server (LFM2.5-8B-A1B)
        +--> llama.cpp server (d1-3B)
        |
        +--> Arize Phoenix (traces)

Python flow (pixi dlly)  --  dataset sampling and preparation
```

- **Node 24 worker** runs the classification batches and the durable workflow. Node 24 is required for built-in `node:sqlite`.
- **Pi Durable** commits a checkpoint before work is shown and resumes unfinished tasks after restart.
- **SQLite** is the single source of truth for the task list, labels and recovery state.
- **GUI** is a separate app; its build output goes to `gui/`.
- **Docker** runs the models, Phoenix and the lab services. All resources use the `dlly-` prefix.
- **Python** (pixi `dlly`) prepares datasets. It does not run the live demo.

## Repository layout

| Path | Role | State |
| --- | --- | --- |
| `docs/` | static GitHub Pages site only (HTML pages and images) | `index.html` empty, `CNAME` set |
| `gui/` | build output directory for the GUI | empty |
| `src/` | Node.js lab code | not created yet |
| `docker/` | container definitions, `dlly-` prefix | empty |
| `lab/` | hands-on plan and experiments | dataset builder + design notes |
| `mds/` | deep dives and reference lists | dataset notes + durable research |
| `datasets/` | curated short-topic datasets | 10k canonical pool + sources, committed |
| `tests/` | Python test code | empty |
| `scratch/` | logs, HF cache and crash artifacts, gitignored except `.gitkeep` | ready |

## Plan and status

- [x] Pixi environment `dlly` with Python 3.12, Node 24.22.1, `huggingface_hub` and `pyarrow`.
- [x] Verify `node:sqlite` and local `npx` installs.
- [x] Research durable execution examples: [mds/durable-execution.md](mds/durable-execution.md).
- [x] Record the static-only rule for `docs/` and the `gui/` build directory.
- [x] Dataset: 10,000 rows, 2,500 per class, 8 folds plus 2,000 holdout rows, committed with source provenance.
- [ ] SQLite schema: runs, tasks, attempts, labels, timings.
- [ ] Node durable worker with 100, 1,000 and 10,000 play modes.
- [ ] llama.cpp Docker services for both models.
- [ ] GUI: batch timing, random kill, recovery replay.
- [ ] Trollino kill script and crash-recovery tests.
- [ ] Arize Phoenix tracing.
- [ ] Static project page in `docs/index.html`.

## Infrastructure

Docker, all resources prefixed `dlly-`:

- llama.cpp server 7.x
- Node 24.x for Pi Durable and the GUI
- Arize Phoenix (traces)

Python tooling runs in the pixi `dlly` environment. Node packages are installed locally with `npx`/`npm`, never globally.

## Inspirations

- [alejandro-ao/pi-durable-demo](https://github.com/alejandro-ao/pi-durable-demo) - direct tutorial inspiration: Node 24, SQLite, llama.cpp, restart recovery.
- [earendil-works/pi - packages/durable](https://github.com/earendil-works/pi/tree/main/packages/durable) - durable harness and design spec.
- [vercel-labs/durable-harness](https://github.com/vercel-labs/durable-harness) - durable adapters for coding agents.
- More links: [mds/durable-execution.md](mds/durable-execution.md).
