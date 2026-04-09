# Web Extraction Runbook

This runbook describes how to extract `core/pirate-web/` toward `pirate-social-club/web` without losing context or pretending the histories already line up.

## Why This Needs Care

Current state:

- `pirate-social-club/web` already exists and is populated
- `core/pirate-web/` also has real history inside `pirate-social-club/core`
- both lineages have ongoing work

That means this is not a simple folder move.

## Precondition

Do not run the split while the relevant work is still mixed together and uncommitted.

Before extraction:

1. decide which `core/pirate-web/` changes you want included
2. commit them in `core`
3. make sure the target working tree for `pirate-social-club/web` is clean or explicitly parked

## Step 1: Produce A Split Branch From `core`

From `pirate-social-club/core`:

```bash
rtk ./scripts/extract-web-subtree.sh
```

Default output branch:

- `core-web-split`

Custom branch:

```bash
rtk ./scripts/extract-web-subtree.sh core-web-split-2026-04-09
```

This creates a branch whose root is the contents and history of `pirate-web/` only.

## Step 2: Prepare A Comparison Workspace

Use a temporary clone of the canonical `web` repo so you can compare histories cleanly:

```bash
rtk git clone https://github.com/pirate-social-club/web.git /tmp/psc-web-compare
```

Add `core` as a second remote:

```bash
rtk git -C /tmp/psc-web-compare remote add core /home/t42/Documents/pirate-v2
rtk git -C /tmp/psc-web-compare fetch core core-web-split
```

## Step 3: Compare The Two Lineages

Graph comparison:

```bash
rtk git -C /tmp/psc-web-compare log --oneline --graph --left-right origin/main...core/core-web-split
```

Diff summary:

```bash
rtk git -C /tmp/psc-web-compare diff --stat origin/main...core/core-web-split
```

Top-level tree comparison:

```bash
rtk git -C /tmp/psc-web-compare diff --name-status origin/main...core/core-web-split
```

## Step 4: Make The Canonical Decision

There are only two valid outcomes.

### Option A: `core/pirate-web/` Wins

Use this if the `core` lineage is now the actual future of the web app.

Recommended merge path:

```bash
rtk git -C /tmp/psc-web-compare checkout -b integrate/core-web-split origin/main
rtk git -C /tmp/psc-web-compare merge --allow-unrelated-histories core/core-web-split
```

Resolve conflicts, verify the resulting tree, then push that integration branch to `pirate-social-club/web` for review.

Do not force-push over `main` unless you intentionally want to discard the current `web` repo lineage.

### Option B: `pirate-social-club/web` Wins

Use this if the existing `web` repo remains canonical and only selected work from `core/pirate-web/` should survive.

In that case:

1. keep `pirate-social-club/web` as source of truth
2. port specific commits or features manually from `core`
3. stop treating `core/pirate-web/` as canonical

## Step 5: Remove The Transitional Root From `core`

Only after `pirate-social-club/web` is clearly canonical:

1. stop making new product commits under `core/pirate-web/`
2. remove or archive `core/pirate-web/`
3. update `core` docs to point to `pirate-social-club/web`

## Recommended Decision Rule

Pick the winner based on which history better represents the future web product, not which repo existed first.

Use these signals:

- which repo contains the intended architecture
- which repo contains the intended UI/system direction
- which repo would require less destructive cleanup after merging
- which repo is already the active place where web work is happening

## Commands Summary

Create split branch:

```bash
rtk ./scripts/extract-web-subtree.sh
```

Compare with the current `web` repo:

```bash
rtk git clone https://github.com/pirate-social-club/web.git /tmp/psc-web-compare
rtk git -C /tmp/psc-web-compare remote add core /home/t42/Documents/pirate-v2
rtk git -C /tmp/psc-web-compare fetch core core-web-split
rtk git -C /tmp/psc-web-compare log --oneline --graph --left-right origin/main...core/core-web-split
rtk git -C /tmp/psc-web-compare diff --stat origin/main...core/core-web-split
```
