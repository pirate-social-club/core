# Pirate Workspace — Agent Style Guidelines

## Typography

- Never use `text-xs` or `text-sm`. Base size is the default `text-base` (16px). Use `text-lg` or larger for emphasis.
- If something feels too big at base size, the problem is layout/spacing, not font size.

## Copy

- No verbose explanatory text. If a label or input makes it obvious, do not add a hint sentence beneath it.
- No "Enter the Reddit account you want to verify." under a field labeled "Reddit username".
- No editorial intro paragraphs on first-run screens.

## Badges / Pills

- Do not use Badge or Pill components to display status information inline (e.g., "Reddit" / "Code ready" / "Verified").
- Status should be plain text, or omitted entirely if the surrounding UI makes state obvious.

## Icons

- Prefer icon-only circle buttons (`Button size="icon" variant="secondary"`) for actions like refresh, toggle, etc.
- Do not add decorative icons next to labels or section titles.

## Layout

- Steppers go above the card, not inside it.
- Titles should be static, not change per phase/step.

## General

- When in doubt, remove it. If cutting text or an element doesn't lose decision value, it shouldn't be there.

## Code Cleanliness

- Do not duplicate helpers, validators, signing/config logic, or route auth patterns; extract shared code on the second real caller.
- Keep modules focused by concern. If a file starts bundling unrelated workflows or grows past easy review size, split along existing interface boundaries.
- Preserve behavior during cleanup: move code mechanically first, then improve it in a separate small commit.
- Avoid no-op wrappers, compatibility shims, and pass-through functions unless they have a dated TODO and an owner.
- Add the smallest targeted check that proves the refactor path, and prefer typecheck plus focused tests over broad runs.

## Multi-Repo Workflow

The canonical local workspace is:

```text
/home/t42/Documents/pirate-workspace/
  core/
  api/
  web/
  contracts/
  desktop/
  android/
```

These are sibling Git repos in one workspace, not Git submodules. `core/` is this repo.

Work from `/home/t42/Documents/pirate-workspace` when reading shared context across repos.
Before editing, decide which repo owns the change.

Typical ownership:

- shared docs/specs/scripts/root config -> `core/`
- backend/API work -> `api/`
- frontend/browser UI -> `web/`
- contract/protocol work -> `contracts/`
- desktop runtime work -> `desktop/`
- Android runtime work -> `android/`

Repo boundary rules:

- the `core` repo must not contain runtime repo checkouts
- do not add or keep `core`-tracked files under `api/`, `web/`, `contracts/`, `desktop/`, or `android/`
- if `core` `git status` shows sibling repo paths, treat that as a boundary violation and fix the checkout layout, `.gitignore`, or parent index before continuing
- do not use or expect `.gitmodules`; these repos are independent sidecar checkouts

If a sibling repo has its own `AGENTS.md`, follow this file for workspace/repo selection and follow the sibling file for repo-local workflows, validation, and product constraints.

## Branch Workflow

All work commits directly to `main`. No feature branches, no task branches.

- commit to `main` in the owning child repo for every completed change
- do not create feature or task branches until the project is stable enough for multiple contributors
- if a task spans multiple child repos, commit to `main` in each repo separately

When a task belongs to a child repo:

- `cd` into the owning sibling repo before committing
- do not keep coding in the wrong repo after discovering the ownership is elsewhere. Stop, switch to the correct repo, and commit there

Read-only Git commands are fine for inspection, including `git status`, `git diff`, `git log`, and `git show`.

## CI Workflow

Use one consistent order of operations in child repos:

1. run the smallest repo-native local check that matches the change
2. if the repo has a real GitHub Actions workflow, run that workflow locally with `agent-ci`
3. push only after the relevant local checks are green, or when remote validation/artifacts are specifically needed
4. let GitHub Actions run remotely on Blacksmith for validation

Tool roles:

- plain git manages commits on main in child repos
- `agent-ci` runs the repo's actual GitHub Actions workflow locally for fast iteration
- Blacksmith is the remote runner for GitHub Actions; it does not replace local checks

Rules:

- do not push just to find out whether CI passes if `agent-ci` can run the same workflow locally
- do not add shared CI planning stubs once a child repo has a real `.github/workflows/*.yml`
- the real workflow file in the child repo is the source of truth for local `agent-ci` runs and remote Blacksmith runs
- if a repo does not yet have a real workflow file, use targeted repo-native local checks until that workflow exists

## Resource Safety

- Treat the user's machine as resource-constrained by default. Prefer the slow path over aggressive parallelism.
- Before starting any dev server, build, watcher, browser automation session, Bruno run, or long test run, check for existing project processes first with `rtk ps -ef` and avoid stacking a second copy on top of an active one.
- Do not start multiple background processes for the same repo at once. Reuse the existing process if possible.
- Keep at most one `agent-browser` session active per repo. Do not run multiple browser sessions, tabs, screenshots, or snapshots in parallel.
- If a long-running process is already active, do not start another heavy process in parallel unless it is clearly necessary and unlikely to increase load materially.
- Prefer one heavy operation at a time:
  - one dev server, or
  - one build, or
  - one browser automation/end-to-end/Bruno run
- Avoid concurrent combinations like `dev server + build`, `dev server + browser automation`, or `multiple dev servers` unless the user explicitly asks for that tradeoff.
- Prefer targeted checks over full runs:
  - run the smallest relevant test file first
  - avoid full builds when a typecheck or narrow test is enough
  - avoid rerunning unchanged long suites just to confirm a small edit
- If I need a long-running process, I should say so first in commentary and explain whether I will keep it running or stop it after use.
- After using a background process I started, clean it up promptly unless the user asked to keep it alive.
- If the machine appears overloaded, stop spawning more work and switch to inspection, static review, or code changes until load is reduced.
- For web work especially, assume builds/watchers can freeze the machine. Start with static analysis, narrow tests, and existing-process reuse before any heavy frontend command.
- In `web/`, do not default to `rtk bun run build`. That full build can freeze the machine.
- Prefer this escalation order for frontend verification:
  - `rtk bun run types`
  - `rtk bun run locales:generate`
  - `rtk ./node_modules/.bin/vite build --ssr src/worker.tsx --minify false --sourcemap false`
  - `rtk ./node_modules/.bin/vite build --minify false --sourcemap false` only when a full production asset build is truly required
- Use `rtk bun run build` only if the lighter Vite commands are insufficient or the user explicitly asks for the full scripted build.
