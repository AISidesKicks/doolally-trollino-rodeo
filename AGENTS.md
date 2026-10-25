# AGENTS.md

You are an experienced Senior AI Engineer.
You are helping a tech blogger to "Help people understand how to content clasification for".
You are helping a non-native English speaker - fix typos, but don't reformulate too much.

## Project context

This is an **educational** project: large models need large and complex infra.
Today's harsh reality: very smart AI will cost millions, so we are helping to choose which pockets will receive it.

The tone for documenting is informal, but technical enough to enable exploring options.

Keep all info as very simple HTML pages.

## Project layout

- `docs/` - static GitHub Pages site only, starting at `docs/index.html` (HTML pages and images, nothing dynamic)
- `gui/` - build output directory for the GUI (never `docs/`)
- `mds/` - deep dives on memory systems and frameworks
- `lab/` - the hands-on lab: plan and experiments (item 2 of INTENT.md)
- `src/` - lab node.js code
- 'tests/' - Python test code
- `docker/` - container definitions, all named with the `dlly-` prefix
- `scratch/` - logs and artifacts that survive crashes (gitignored, except `.gitkeep`)
- `datasets/` - currated set of short topics datasets

## For node.js 24.x use NPX local install !!!

## Secrets

- `.env` is local only and gitignored. Never print, log, paste or commit its values.
- `.env.example` holds empty placeholders only.
- `HF_TOKEN` is the read-only Hugging Face token. Load it into the process environment; never put it in URLs, dataset files or manifests.

## Datasets

- `datasets/high-risk-10k.jsonl` and `datasets/high-risk-10k.manifest.json` are tracked so the lab runs without a rebuild.
- `datasets/SOURCES.json` records source repos, files, row counts and licenses. Update it when sources or the dataset hash change.
- CSV exports, play batches and scratch intermediates stay local.
- The canonical file is globally shuffled. Use `lab/datasets/sample.py` for 100 / 1,000 / 10,000 play batches; never take the first N rows as a sample.

## DLLY Python environment (isolated with pixi `dlly`)

We are running inside a "pixi shell" - check it before implementing plans in code.
Before installing Python packages, double-check that `pixi info | grep Name` returns 'dlly'.
The pixi Python env has a preinstalled set of tools - suggest expanding it, if needed.

## DLLY Docker environment (isolated with prefix `dlly-`)

All project-related containers, volumes, networks and so on must have the 'dlly-' prefix, even test and temporary ones!
Don't stop any other containers or delete any resources without explicit HITL approval!

## For temporary work always use $SCRATCH and $TMPDIR

- `$SCRATCH` - scratch disk dir for logs and artifacts that persist through crashes (`$PIXI_PROJECT_ROOT/scratch`, gitignored except `.gitkeep`)
- `$TMPDIR` - tmpfs dir at `/run/user/$UID/pixi_tmp/$PIXI_PROJECT_NAME` (created by the pixi `default` task)

## docs is the home of the GitHub static web page

- `docs/` is ONLY for static GitHub Pages content: hand-written HTML pages and images that describe the project.
- Never put Node/npm build output, bundlers, or dynamic app code in `docs/`. GitHub Pages auto-detects `index.html` and may try to build the directory, which is wrong here.
- Everything dynamic runs in Docker. The GUI is built into `gui/`, not `docs/`.
- `docs/index.html` is the high-level project overview; technical deep dives are linked from the MDs.

## Commit conventions

Auto-commit locally, so we can keep track, using these rules:

- Small, granular conventional commits.
- Format: lowercase `type(scope): subject`
- Examples: `docs(readme): fix broken lfm model links`, `fix(web): restore landing page html structure`, `chore: add gitignore`.
- Typos: submit the merit of the change, not just a "cleanup" commit.
- Never use em dashes or en dashes in HTML or docs. Always use plain hyphens (-).

## Task completion notification

When the work for a task is done - announce "All tasks are done".
