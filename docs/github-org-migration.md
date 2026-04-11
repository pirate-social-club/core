# GitHub Org Migration

Target org: `pirate-social-club`

## Target repo map

Use short repo names inside the org:

- `android` from local `/home/t42/Documents/pirate/pirate-android`
- `ios` from local `/home/t42/Documents/pirate/pirate-ios`
- `web` from local `/home/t42/Documents/pirate/pirate-web`
- `api` from local `/home/t42/Documents/pirate/pirate-api`
- `contracts` from local `/home/t42/Documents/pirate/pirate-contracts`
- `desktop` from local `/home/t42/Documents/pirate/pirate-desktop`
- `tui` from local `/home/t42/Documents/pirate-v2/pirate-tui`
- `core` from local `/home/t42/Documents/pirate-v2`

Recommended visibility:

- `public`: `android`, `ios`, `web`, `contracts`, `desktop`, `tui`
- `private`: `api`, `core`

## Current state

Verified locally after migration:

- the major Pirate surfaces are separate Git repos locally
- local `origin` remotes now point at `https://github.com/pirate-social-club/...`
- `/home/t42/Documents/pirate-v2` now tracks `https://github.com/pirate-social-club/core.git`
- org repos now exist:
  - public: `android`, `ios`, `web`, `contracts`, `desktop`
  - private: `api`, `core`
- `tui` is still tracked inside `core` and should be split into its own public repo
- `api` was moved to private after transfer
- `android` was created directly in the org and pushed from the local repo because the old GitHub source repo no longer resolved cleanly during transfer lookup

## Preferred migration method

Prefer **repository transfer** over creating fresh repos and force-pushing.

Why:

- preserves stars, issues, PR history, watchers, settings history where possible
- keeps existing URLs redirecting
- keeps the repo graph cleaner

For each existing GitHub repo under `technohippi3`, transfer it into the org and rename it during transfer if GitHub allows it. If GitHub does not allow rename during transfer, transfer first and rename second.

## Step 1: Fix GitHub auth

```bash
rtk gh auth login -h github.com
rtk gh auth status
```

Then verify org visibility:

```bash
rtk gh repo list pirate-social-club --limit 100
```

## Step 2: Check for existing org repos before transfer

Run this before creating or transferring anything:

```bash
rtk gh repo view pirate-social-club/android
rtk gh repo view pirate-social-club/ios
rtk gh repo view pirate-social-club/web
rtk gh repo view pirate-social-club/api
rtk gh repo view pirate-social-club/contracts
rtk gh repo view pirate-social-club/desktop
rtk gh repo view pirate-social-club/tui
rtk gh repo view pirate-social-club/core
```

If a repo already exists, inspect it first:

```bash
rtk gh repo view pirate-social-club/android --web
```

## Step 3: Transfer existing repos into the org

Likely source repos:

- `technohippi3/pirate-android`
- `technohippi3/pirate-ios`
- `technohippi3/pirate-web`
- `technohippi3/pirate-api`
- `technohippi3/pirate-contracts`
- `technohippi3/pirate-desktop`

GitHub transfer is easiest in the web UI:

1. Open repo settings.
2. Scroll to `Danger Zone`.
3. Choose `Transfer ownership`.
4. Transfer to `pirate-social-club`.
5. Rename to the short target name if needed.

If a repo is already in the org but still named with the old prefix, rename it:

- `pirate-social-club/pirate-android` -> `pirate-social-club/android`
- `pirate-social-club/pirate-ios` -> `pirate-social-club/ios`
- `pirate-social-club/pirate-web` -> `pirate-social-club/web`
- `pirate-social-club/pirate-api` -> `pirate-social-club/api`
- `pirate-social-club/pirate-contracts` -> `pirate-social-club/contracts`
- `pirate-social-club/pirate-desktop` -> `pirate-social-club/desktop`

## Step 4: Create the new `core` repo from `pirate-v2`

Create the repo:

```bash
rtk gh repo create pirate-social-club/core --private --description "Specs, control-plane, migrations, and system integration for Pirate Social Club"
```

Create the TUI repo:

```bash
rtk gh repo create pirate-social-club/tui --public --description "Terminal client for Pirate Social Club"
```

Attach the remote locally:

```bash
rtk git -C /home/t42/Documents/pirate-v2 remote add origin https://github.com/pirate-social-club/core.git
rtk git -C /home/t42/Documents/pirate-v2 push -u origin main
```

## Step 5: Update local remotes after transfer

After the org repos exist, repoint local `origin` URLs.

### Android

```bash
rtk git -C /home/t42/Documents/pirate/pirate-android remote set-url origin https://github.com/pirate-social-club/android.git
rtk git -C /home/t42/Documents/pirate/pirate-android remote -v
```

### iOS

```bash
rtk git -C /home/t42/Documents/pirate/pirate-ios remote set-url origin https://github.com/pirate-social-club/ios.git
rtk git -C /home/t42/Documents/pirate/pirate-ios remote -v
```

### Web

```bash
rtk git -C /home/t42/Documents/pirate/pirate-web remote set-url origin https://github.com/pirate-social-club/web.git
rtk git -C /home/t42/Documents/pirate/pirate-web remote -v
```

### API

```bash
rtk git -C /home/t42/Documents/pirate/pirate-api remote set-url origin https://github.com/pirate-social-club/api.git
rtk git -C /home/t42/Documents/pirate/pirate-api remote -v
```

### Contracts

```bash
rtk git -C /home/t42/Documents/pirate/pirate-contracts remote set-url origin https://github.com/pirate-social-club/contracts.git
rtk git -C /home/t42/Documents/pirate/pirate-contracts remote -v
```

### Desktop

```bash
rtk git -C /home/t42/Documents/pirate/pirate-desktop remote set-url origin https://github.com/pirate-social-club/desktop.git
rtk git -C /home/t42/Documents/pirate/pirate-desktop remote -v
```

### Core

```bash
rtk git -C /home/t42/Documents/pirate-v2 remote -v
```

### TUI

```bash
rtk git -C /home/t42/Documents/pirate-v2/pirate-tui remote add origin https://github.com/pirate-social-club/tui.git
rtk git -C /home/t42/Documents/pirate-v2/pirate-tui remote -v
```

## Step 6: Verify branch tracking after remote changes

```bash
rtk git -C /home/t42/Documents/pirate/pirate-android remote show origin
rtk git -C /home/t42/Documents/pirate/pirate-ios remote show origin
rtk git -C /home/t42/Documents/pirate/pirate-web remote show origin
rtk git -C /home/t42/Documents/pirate/pirate-api remote show origin
rtk git -C /home/t42/Documents/pirate/pirate-contracts remote show origin
rtk git -C /home/t42/Documents/pirate/pirate-desktop remote show origin
rtk git -C /home/t42/Documents/pirate-v2/pirate-tui remote show origin
rtk git -C /home/t42/Documents/pirate-v2 remote show origin
```

## Step 7: Standardize repo metadata

Recommended descriptions:

- `android`: `Primary Android client for Pirate Social Club`
- `ios`: `Native iOS client for Pirate Social Club`
- `web`: `Web client for Pirate Social Club`
- `api`: `Backend services for Pirate Social Club`
- `contracts`: `Smart contracts for Pirate Social Club`
- `desktop`: `Desktop client for Pirate Social Club`
- `tui`: `Terminal client for Pirate Social Club`
- `core`: `Specs, control-plane, migrations, and system integration for Pirate Social Club`

## Step 8: Decide canonical upstream policy

Several current repos say Radicle is canonical and GitHub is a mirror. Make this explicit after the org move:

- either GitHub becomes canonical
- or GitHub remains a mirror

Do not leave mixed wording across repos.

## Notes

- `api` should stay private for now unless you want backend internals public.
- `core` should stay private until the structure stabilizes.
- `tui` should be public once split unless it starts carrying secrets or private operator tooling
- do not merge Android, iOS, web, backend, contracts, desktop, and tui into one GitHub repo
- use the org as the unifying layer, not a mega-monorepo
