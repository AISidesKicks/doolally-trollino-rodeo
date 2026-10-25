#!/usr/bin/env python3
"""Download the lab GGUF models directly into the project `models/` folder.

The Hugging Face cache is not used as the visible location: each file is
written to `models/<filename>` with `hf_hub_download(..., local_dir=...)`.
An interrupted download resumes from the `.incomplete` file on the next run.

Usage:
    pixi run python lab/models/download.py --check
    pixi run python lab/models/download.py
    pixi run python lab/models/download.py --only d1
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = PROJECT_ROOT / "models"
ENV_FILE = PROJECT_ROOT / ".env"

MODELS = {
    "lfm": {
        "repo_id": "LiquidAI/LFM2.5-8B-A1B-GGUF",
        "filename": "LFM2.5-8B-A1B-Q4_K_M.gguf",
        "role": "chat classifier, OpenAI-compatible endpoint",
    },
    "d1": {
        "repo_id": "LiquidAI/d1-3B-GGUF",
        "filename": "d1-3B-Q4_K_M.gguf",
        "role": "decision model, /v1/systemone endpoint",
    },
}


def load_env(path: Path) -> None:
    """Load KEY=VALUE lines into the process environment without printing them."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value:
            os.environ.setdefault(key, value)


def human_bytes(size: int) -> str:
    return f"{size / 1_000_000_000:.2f} GB"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def remote_info(api, repo_id: str, filename: str):
    info = api.model_info(repo_id, files_metadata=True)
    for sibling in info.siblings:
        if sibling.rfilename == filename:
            lfs = getattr(sibling, "lfs", None)
            if isinstance(lfs, dict):
                sha = lfs.get("sha256")
            else:
                sha = getattr(lfs, "sha256", None)
            return sibling.size or 0, sha
    raise SystemExit(f"{filename} not found in {repo_id}")


def download_one(api, key: str, spec: dict, verify: bool) -> dict:
    from huggingface_hub import hf_hub_download

    repo_id = spec["repo_id"]
    filename = spec["filename"]
    target = MODELS_DIR / filename

    print(f"\n== {key}: {filename}")
    print(f"   repo: {repo_id}")
    size, remote_sha = remote_info(api, repo_id, filename)
    print(f"   size: {human_bytes(size)}")

    if target.exists() and target.stat().st_size == size:
        print("   status: already complete, skipping download")
    else:
        print("   status: downloading ...")
        path = Path(
            hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=MODELS_DIR,
                token=os.environ.get("HF_TOKEN") or None,
            )
        )
        actual = path.stat().st_size
        if actual != size:
            raise SystemExit(f"size mismatch for {path}: {actual} != {size}")
        target = path
        print(f"   status: downloaded to {target}")

    result = {
        "key": key,
        "path": target,
        "size": target.stat().st_size,
        "sha256": None,
        "sha256_ok": None,
    }

    if verify and remote_sha:
        print(f"   hashing {human_bytes(target.stat().st_size)} ...")
        local_sha = sha256_file(target)
        result["sha256"] = local_sha
        result["sha256_ok"] = local_sha == remote_sha
        print(f"   sha256: {local_sha[:16]}... {'ok' if result['sha256_ok'] else 'MISMATCH'}")
        if not result["sha256_ok"]:
            raise SystemExit(f"sha256 mismatch for {target}")

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=sorted(MODELS), action="append", help="download only these keys")
    parser.add_argument("--check", action="store_true", help="print remote metadata and local state, download nothing")
    parser.add_argument("--no-verify", action="store_true", help="skip the sha256 check after download")
    args = parser.parse_args()

    load_env(ENV_FILE)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    if importlib.util.find_spec("hf_xet"):
        os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")

    from huggingface_hub import HfApi

    api = HfApi(token=os.environ.get("HF_TOKEN") or None)
    keys = args.only or list(MODELS)

    if args.check:
        for key in keys:
            spec = MODELS[key]
            size, sha = remote_info(api, spec["repo_id"], spec["filename"])
            target = MODELS_DIR / spec["filename"]
            local = target.stat().st_size if target.exists() else 0
            print(f"{key}: {spec['filename']}")
            print(f"  repo:   {spec['repo_id']}")
            print(f"  remote: {human_bytes(size)} sha256 {sha[:16] if sha else 'unknown'}...")
            print(f"  local:  {human_bytes(local) if local else 'missing'}")
        return

    print(f"Models directory: {MODELS_DIR}")
    results = [download_one(api, key, MODELS[key], verify=not args.no_verify) for key in keys]

    print("\nDone:")
    for result in results:
        status = "ok" if result["sha256_ok"] in (True, None) else "bad hash"
        print(f"  {result['path'].name}: {human_bytes(result['size'])} ({status})")


if __name__ == "__main__":
    main()
