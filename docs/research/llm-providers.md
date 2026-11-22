# Free LLM APIs & model routing

**Inspected 2026-10-09 (bounded).** Primary sources opened:
- https://github.com/open-free-llm-api/awesome-freellm-apis (README tables)
- https://freellm.net (directory + config generator)
- Instagram post https://www.instagram.com/p/DeB_xCxDT_F/ — **not accessible** (login wall).

## What these resources actually are

A GitHub directory (MIT) and a companion site cataloguing free/low-cost LLM API
tiers, with filters and a config generator for tools like Claude Code/Cursor.
Active (196 commits, ~3.9k stars, README dated 2026-10-09).

### Verified caveats (do not treat the catalogue as ground truth)

- **Counts contradict themselves:** README header says "505+ … 30 providers",
  the About says "134+ … 40+ providers", the footer says "453 models". The
  Instagram "452+ APIs / 31 providers" figure matches none of these and could
  not be verified from the post.
- **No structured-output data.** The pages never mention JSON/structured output.
  GradTools' extraction *requires* a strict schema reply, so this cannot be taken
  on faith for any listed provider.
- **"Modalities" ≠ input.** The column lists vision-capable models but does not
  separate image *input* from image *generation*. e.g. `agnes-image-2.0-flash`
  looks like generation, not a reader.
- **"Free" is mixed.** Several rows under "Permanent Free Tiers" are actually
  credit-based (xAI, Hugging Face credit-metered, Nscale/Nebius fair-use/tiered).
- **Operational realities:** some providers need phone verification (NVIDIA NIM,
  Mistral); freellm.net has sponsored listings and a paid tier; "235 verified via
  live API" is their claim, not independently checked here.

## GradTools' existing setup (the bar any provider must clear)

Source: [`services/api/src/documents/router.ts`](../../services/api/src/documents/router.ts),
`openrouter.ts`, `gemini.ts`, `read.ts`; policy in `docs/13 §13.31`, `docs/19`.

GradTools already has a small, security-conscious **provider router**:

- Tries approved providers in fixed priority; first schema-valid reply wins;
  per-provider cooldowns; hard attempt cap; no paid fallback; server-only creds.
- **Eligibility is fail-closed.** A provider routes only if it is enabled, takes
  an image, produces structured output, **and proves $0 per read against the
  provider's own live pricing** (`zeroCost: 'verified-per-read'`). A provider
  whose free-ness is only a config flag (`deployment-approved`, e.g. Gemini) is
  **ineligible** — a boolean can't establish zero cost.
- The deterministic academic engine stays authoritative; AI only *reads*
  documents, it never computes academic facts.
- Adding a provider = append a `Provider` entry; the pipeline is untouched.

## Mapping: can the catalogue help GradTools?

The three things GradTools requires — **verified $0 per read**, **ZDR/privacy**,
**structured output** — are exactly the three the catalogue does **not**
establish. OpenRouter (already integrated) is the one listed provider whose live
pricing lets the reader prove $0 per call. So:

- **Use the catalogue as a discovery shortlist**, to find *additional
  OpenRouter-routable* free models that accept image input and return strict
  JSON — then verify each against the reader's own checks.
- **Do not** add a new provider SDK/base-URL from the catalogue on its say-so. A
  "free, vision" row there has not proven $0-per-read, ZDR, or schema output.

## Decision

**Adapt-as-reference / Defer** (see [`implementation-decisions.md`](./implementation-decisions.md)).
No code change this pass. A concrete next step, when justified and approved:
evaluate 1–2 candidate free OpenRouter vision+JSON models as additional `Provider`
entries behind the existing router, each with a $0-verification + privacy review +
a failure-path test. No new infrastructure, no second provider abstraction.

### Explicitly rejected moves

- Bulk-adding providers "because they're free." Fails the router's bar and
  multiplies privacy/limit/deprecation risk.
- Routing student documents through any provider lacking a verifiable $0 tier,
  ZDR, and structured output.
- Weakening the deterministic academic engine with an LLM because a model is free.
