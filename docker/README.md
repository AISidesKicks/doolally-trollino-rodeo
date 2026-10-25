# Docker stack

All containers, volumes and networks use the `dlly-` prefix. The compose project is `dlly-lab`, the network is `dlly-net`.

## Prerequisites

- Docker Engine with the NVIDIA container runtime
- Docker Compose v2
- An NVIDIA GPU with enough VRAM for the models you start
- GGUFs in `models/gguf/` (see [../models/README.md](../models/README.md))

Check GPU passthrough:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```

## Services

| Service | Container | Host port | Role |
| --- | --- | --- | --- |
| `llama-lfm` | `dlly-llama-lfm` | 8081 | LFM2.5-8B-A1B chat classifier |
| `llama-d1` | `dlly-llama-d1` | 8082 | d1-3B decision model |
| `llama-lfm-ft` | `dlly-llama-lfm-ft` | 8083 | optional LFM fine-tune, profile `lfm-ft` |
| `phoenix` | `dlly-phoenix` | 6006, 4317 | Arize Phoenix UI and OTLP |
| `lab` | `dlly-lab` | 3030 | Node 24 GUI, API and worker |

Volumes: `dlly-lab-data` for the SQLite database and worker logs, `dlly-phoenix-data` for traces.

## Start

```bash
# default stack: stock LFM, d1, Phoenix and the lab
docker compose -f docker/compose.yaml up -d --build

# watch startup
docker compose -f docker/compose.yaml ps
docker logs -f dlly-llama-lfm
docker logs -f dlly-lab
```

The GUI is at http://127.0.0.1:3030. Phoenix is at http://127.0.0.1:6006.

## Smoke tests

```bash
curl -sS http://127.0.0.1:8081/health
curl -sS http://127.0.0.1:8082/health
curl -sS http://127.0.0.1:3030/api/health

curl -sS http://127.0.0.1:8082/v1/systemone \
  -H 'content-type: application/json' \
  -d '{"state":"My doctor changed my blood pressure medication.","questions":{"category":{"type":"choice","instructions":"Pick one category.","criteria":{"Medical & Health":"medical advice","Politics & Elections":"politics","Legal & Regulatory":"law","Financial & Crypto":"money"}}}}'
```

The d1 answer arrives at `answers.category.choice` with calibrated probabilities.

## Benchmark modes

All three modes use the same API. A 1,000 run with the holdout excluded takes about 10 minutes on the RTX 4070. The full 10,000 run takes about 91 minutes.

```bash
# 100-task pilot, clean sample
curl -sS -X POST http://127.0.0.1:3030/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":100,"provider":"llama","batchSize":3,"pauseMs":0,"retries":1,"excludeHoldout":true}'

# 1,000-task clean benchmark
curl -sS -X POST http://127.0.0.1:3030/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":1000,"provider":"llama","batchSize":3,"pauseMs":0,"retries":1,"excludeHoldout":true}'

# 10,000-task full-pool stress run
curl -sS -X POST http://127.0.0.1:3030/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":10000,"provider":"llama","batchSize":3,"pauseMs":0,"retries":1,"excludeHoldout":false}'
```

The 10,000 mode includes the holdout. A clean 10,000 sample is not possible because the non-holdout folds only have 2,000 rows per class.

## Optional LFM fine-tune

The fine-tune is 6.17 GB. On a 12 GB GPU it can run next to d1, but not next to stock LFM as well. Stop stock LFM first:

```bash
docker compose -f docker/compose.yaml stop llama-lfm
docker compose -f docker/compose.yaml --profile lfm-ft up -d llama-lfm-ft

# back to the default
docker compose -f docker/compose.yaml stop llama-lfm-ft
docker compose -f docker/compose.yaml start llama-lfm
```

Use it with the worker:

```bash
npm run worker -- run --mode 100 --provider llama --models lfm-ft,d1 --lfm-ft-url http://127.0.0.1:8083
```

On the 100-task sample it scored 65% at 110 ms, against 85% at 594 ms for stock LFM at 85% and 26 ms for d1. It stays optional.

## Reset the demo database

Commit history lives in the volume. To start a clean demo:

```bash
docker compose -f docker/compose.yaml stop lab
docker run --rm -v dlly-lab-data:/data dlly-lab-lab rm -f /data/lab.db /data/lab.db-wal /data/lab.db-shm
docker compose -f docker/compose.yaml start lab
```

## Rebuild after code changes

```bash
docker compose -f docker/compose.yaml up -d --build lab
```

The image builds the GUI into `/app/gui` from `src/gui`. The build context excludes `models/`, `scratch/`, `docs/` and `.env`.

## Notes

- The llama.cpp services are CPU by default only if you remove the `deploy.resources` GPU reservation. The checked-in stack expects NVIDIA.
- The models are mounted read-only from `../models`.
- `--reasoning-budget 128` keeps LFM's reasoning short. Remove it if you want unrestricted chain-of-thought, but expect much longer runs.
- Phoenix is running, and the worker exports one span per committed batch. Open http://127.0.0.1:6006 and pick the `default` project. Spans carry `run.id`, `batch.index`, `batch.tasks`, `batch.errors`, `batch.retries` and `run.completed`.
