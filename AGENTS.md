# Pirate V2 — Agent Style Guidelines

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

## Multi-Repo Workflow

This parent folder contains multiple separate Git repos.
They are sibling repos in one workspace, not Git submodules:

- `pirate-api/`
- `pirate-web/`
- `pirate-tui/`
- `pirate-contracts/`

Work from the parent folder when reading shared context across repos.
Before editing, decide which repo owns the change.

Typical ownership:

- backend/API work -> `pirate-api/`
- frontend/browser UI -> `pirate-web/`
- terminal app work -> `pirate-tui/`
- contract/protocol work -> `pirate-contracts/`
- shared docs/scripts/root config -> parent repo

Repo boundary rules:

- the parent `core` repo must ignore all four child repo roots
- do not add or keep parent-repo tracked files under `pirate-api/`, `pirate-web/`, `pirate-tui/`, or `pirate-contracts/`
- if parent `git status` shows child-repo paths, treat that as a boundary violation and fix the parent `.gitignore` or parent index before continuing
- do not use or expect `.gitmodules`; these repos are independent sidecar checkouts

If a child repo has its own `AGENTS.md`, follow the root file for workspace/repo selection and follow the child file for repo-local workflows, validation, and product constraints.

## GitButler Rules

When a task belongs to a child repo:

- inspect from the parent folder if shared context helps
- `cd` into the owning child repo before branch creation, branch switching, or commits
- keep one task per branch
- keep one active agent per branch
- prefer parallel branches for unrelated work
- use stacked branches only when one change depends on another unfinished branch in the same repo

For GitButler-managed child repos, do not use raw Git branch/commit mutation commands unless the user explicitly asks:

- `git checkout`
- `git switch`
- `git branch`
- `git commit`

Use GitButler-compatible commands instead:

- `but branch new <task-slug>`
- `gitbutler_update_branches`
- `but commit -m "<message>"`

Read-only Git commands are fine for inspection, including `git status`, `git diff`, `git log`, and `git show`.

If a task spans multiple child repos:

- handle each repo separately
- create one branch per repo
- use the same task slug in each repo when possible
- report results per repo, not as one mixed branch

Do not create child-repo branches from the parent folder.
Do not keep coding in the wrong repo after discovering the ownership is elsewhere.
Stop, switch to the correct repo, and branch there.

## CI Workflow

Use one consistent order of operations in child repos:

1. create or switch the task branch with GitButler
2. run the smallest repo-native local check that matches the change
3. if the repo has a real GitHub Actions workflow, run that workflow locally with `agent-ci`
4. push only after the relevant local checks are green, or when remote validation/artifacts are specifically needed
5. let GitHub Actions run remotely on Blacksmith for PR and branch validation

Tool roles:

- GitButler manages branch and stack workflow in child repos
- `agent-ci` runs the repo's actual GitHub Actions workflow locally for fast iteration
- Blacksmith is the remote runner for GitHub Actions; it does not replace local checks

Rules:

- do not push just to find out whether CI passes if `agent-ci` can run the same workflow locally
- do not treat `docs/ci/*.yml` as executable CI once a repo has a real `.github/workflows/*.yml`
- the real workflow file in the child repo is the source of truth for local `agent-ci` runs and remote Blacksmith runs
- if a repo does not yet have a real workflow file, use targeted repo-native local checks until that workflow exists

## Resource Safety

- Treat the user's machine as resource-constrained by default. Prefer the slow path over aggressive parallelism.
- Before starting any dev server, build, watcher, browser automation session, Bruno run, or long test run, check for existing project processes first with `rtk ps -ef` and avoid stacking a second copy on top of an active one.
- Do not start multiple background processes for the same repo at once. Reuse the existing process if possible.
- If a long-running process is already active, do not start another heavy process in parallel unless it is clearly necessary and unlikely to increase load materially.
- Prefer one heavy operation at a time:
  - one dev server, or
  - one build, or
  - one end-to-end/Bruno run
- Avoid concurrent combinations like `dev server + build`, `dev server + browser automation`, or `multiple dev servers` unless the user explicitly asks for that tradeoff.
- Prefer targeted checks over full runs:
  - run the smallest relevant test file first
  - avoid full builds when a typecheck or narrow test is enough
  - avoid rerunning unchanged long suites just to confirm a small edit
- If I need a long-running process, I should say so first in commentary and explain whether I will keep it running or stop it after use.
- After using a background process I started, clean it up promptly unless the user asked to keep it alive.
- If the machine appears overloaded, stop spawning more work and switch to inspection, static review, or code changes until load is reduced.
- For web work especially, assume builds/watchers can freeze the machine. Start with static analysis, narrow tests, and existing-process reuse before any heavy frontend command.
- In `pirate-web`, do not default to `rtk bun run build`. That full build can freeze the machine.
- Prefer this escalation order for frontend verification:
  - `rtk bun run types`
  - `rtk bun run locales:generate`
  - `rtk ./node_modules/.bin/vite build --ssr src/worker.tsx --minify false --sourcemap false`
  - `rtk ./node_modules/.bin/vite build --minify false --sourcemap false` only when a full production asset build is truly required
- Use `rtk bun run build` only if the lighter Vite commands are insufficient or the user explicitly asks for the full scripted build.

## Design Context

### Users
Pirate users arriving from Reddit who are importing identity, karma, and community context into Pirate.
They are likely evaluating the product quickly, often on mobile, and need the onboarding flow to feel familiar enough that the migration step feels low-risk.

### Brand Personality
Internet-native, direct, confident.
The interface should feel credible and sharp, not playful or over-explained.

### Aesthetic Direction
Dark-first, community-feed shell chrome with Pirate branding only.
Navigation can borrow familiar interaction patterns, but never third-party logos or copied brand marks.
Use orange as the primary accent, keep the rest of the palette restrained, and avoid decorative status UI that adds noise.

### Design Principles
1. Keep imported-user flows visually familiar without copying third-party branding.
2. Prioritize fast scanning and decision-making over explanatory copy.
3. Treat mobile as a first-class context, with thumb-friendly top and bottom navigation.
4. Use strong contrast and a restrained orange accent instead of adding more UI elements.
5. Keep onboarding structure stable: progress above the card, card content focused, no redundant labels.
