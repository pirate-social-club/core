# Localization

Status: draft

Related docs:

- [profile.md](./profile.md)
- [post.md](./post.md)
- [feed.md](./feed.md)

## Purpose

This doc defines Pirate's authoritative locale contract for SSR, hydration, and localized read surfaces.

It covers:

- locale precedence
- locale normalization
- SSR and hydration behavior
- relationship between canonical text and translated projections

## Core Principle

Pirate should resolve locale on the server first and treat localization as a first-class read concern.

Redwood SSR should render against one authoritative locale, not let each client surface infer locale independently after the fact.

## Locale Precedence

Recommended authoritative precedence:

1. persisted user `preferred_locale`
2. explicit route or surface override
3. request `Accept-Language`
4. default `en`

Rules:

- server-rendered reads should use this precedence chain
- clients may inspect browser locale signals after hydration, but those signals do not outrank a persisted user preference or explicit route override
- locale negotiation should use normalized locale tags

## Locale Normalization

Pirate should normalize locale tags before lookup, cache writes, and API responses.

Rules:

- use normalized BCP 47-style tags
- preserve script subtags where they matter, such as `zh-Hans` and `zh-Hant`
- treat equivalent locale aliases as the same normalized locale for cache lookups
- cache rows should be written under the resolved normalized locale

## SSR Contract

Redwood SSR should render the localized read model for the resolved server locale.

Rules:

- the server should resolve locale before feed and post reads
- `html[lang]` and localized data payloads should agree on the same resolved locale
- SSR should fetch or project translated variants for that locale before rendering when policy permits

## Hydration Promotion Rule

Hydration should not eagerly replace a valid non-English SSR locale with browser English.

Recommended rule:

- if SSR rendered with a non-English authoritative locale, hydration should keep that locale even when browser APIs report English
- if SSR had to fall back to English only because no stronger server signal existed, and the hydrated client resolves to a non-English locale, the client may promote from English to that non-English locale after hydration

This preserves deterministic first paint while still improving locale quality for cold-start users whose browser preferences were unavailable to SSR.

## Localized Read Surfaces

Localized read surfaces should preserve canonical source text and return translated projections separately.

Rules:

- canonical source text remains the original authored text
- translated text is a derived projection for the resolved locale
- reads should include the resolved locale and whether machine translation is being shown
- clients should always keep original text accessible inline when translated text is displayed

## Future Public Registry Reads

If Pirate later reintroduces a public onchain registry, localization should
still stay in the app read layer rather than the registry row itself.

Rules:

- Redwood SSR should consume an API-served localized read model
- locale resolution, translation policy, translation cache lookup, and translated projections are API responsibilities
- localized app reads must preserve a stable canonical source independent of viewer locale
