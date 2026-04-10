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
