# Local GGUF models

Weights are local only. Git tracks this README and `gguf/.gitkeep`; every `.gguf` file is ignored.

## Layout

```
models/
  README.md
  .gitkeep
  gguf/
    .gitkeep
    LFM2.5-8B-A1B-Q4_K_M.gguf      5,155,564,768 bytes
    d1-3B-Q4_K_M.gguf              1,674,456,672 bytes
    LFM2.5-8B-A1B-FT-Q4KXL.gguf    6,166,588,576 bytes  optional
```

## Download

```bash
# default pair, about 6.8 GB
pixi run python lab/models/download.py

# check remote names, sizes and local state without downloading
pixi run python lab/models/download.py --check

# optional instruction-tuned variant, about 6.2 GB
pixi run python lab/models/download.py --only lfm-ft
```

The script writes directly into `models/gguf/` and verifies the SHA-256 from the Hugging Face file metadata. `HF_TOKEN` is read from `.env` when present and is never printed.

## Integrity

| File | SHA-256 |
| --- | --- |
| `LFM2.5-8B-A1B-Q4_K_M.gguf` | `4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0` |
| `d1-3B-Q4_K_M.gguf` | `16aff27ea2eefdc32b9897f43854a5d3170c1dc8dccb9c756905af30a4e22402` |
| `LFM2.5-8B-A1B-FT-Q4KXL.gguf` | `a2b14942cee4ea3b23474322e291dab7663e8c3efb5809e02b81ac9ccad10c06` |

## Models

| Key | Repo | Role | Size |
| --- | --- | --- | --- |
| `lfm` | [LiquidAI/LFM2.5-8B-A1B-GGUF](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF) | chat classifier, reasoning capped in the lab | 5.16 GB |
| `d1` | [LiquidAI/d1-3B-GGUF](https://huggingface.co/LiquidAI/d1-3B-GGUF) | decision model, `/v1/systemone` | 1.67 GB |
| `lfm-ft` | [jakeatx/LFM-2.5-8B-1B-hermes-ft](https://huggingface.co/jakeatx/LFM-2.5-8B-1B-hermes-ft) | optional instruction-tuned LFM2.5 variant | 6.17 GB |

The optional file is called **LFM2.5-8B-A1B FT** in this repo. The upstream repo name includes the training framework, which is also the name of an agent harness, so the app does not use it. On the 100-task sample it scored 65% at 110 ms, against 85% at 594 ms for stock LFM, so it is not the default.

## Licenses

- LFM2.5-8B-A1B and d1-3B: Liquid AI LFM Open License v1.0 (`lfm1.0` on the model cards). Review the terms before redistribution or commercial use.
- The optional fine-tune inherits the LFM2.5 license. It is a community checkpoint, not an official Liquid AI release.

## GPU budget

On an RTX 4070 with 12 GB:

- d1 plus stock LFM: about 9.0 GB used, both resident.
- d1 plus the optional FT: about 10.0 GB used, both resident.
- Do not run all three at once. Stop `llama-lfm` before starting the optional profile.
