# Architecture & engineering patterns

Transferable patterns worth reusing — starting with one GradTools already
embodies, so a future project can copy it rather than re-derive it.

## Pattern: fail-closed, zero-cost-verified AI provider router

**Source (in this repo):**
[`services/api/src/documents/router.ts`](../../services/api/src/documents/router.ts)
(+ `openrouter.ts`, `gemini.ts`, `read.ts`; policy `docs/13 §13.31`, `docs/19`).
Inspected 2026-10-09.

**The finding.** When an app depends on free/third-party LLMs, the safe shape is a
thin router over interchangeable provider *readers*, where eligibility is
**fail-closed** on four independent checks — enabled, image input, structured
output, and **$0 proven per request against the provider's own live pricing** —
with per-provider cooldowns, a hard attempt cap, no paid fallback, and
server-only credentials. A provider whose free-ness is merely a config flag is
ineligible; a boolean cannot establish zero cost.

**Why it matters.** It makes "add a free model" a one-line, low-risk append while
making it structurally impossible to (a) incur surprise cost, (b) leak documents
to an unvetted endpoint, or (c) let the model override deterministic logic — the
three ways a free-LLM feature usually goes wrong.

**When to use.** Any feature that calls external models on user content and must
stay $0 and privacy-safe.
**When not to.** A single paid, contracted provider with a budget — the $0
machinery is then overhead; keep the reader/validator split, drop the cost gate.

**Trade-offs / failure modes.** In-process health is per-instance (not shared
across replicas); cooldowns are heuristics; "free" can change under you — the
per-read price check is what defends against that, which is why it must stay.

## Related

- LLM provider evaluation and the free-API directories: [`llm-providers.md`](./llm-providers.md).
- Keep AI strictly separated from the deterministic academic engine (`docs/16`,
  `docs/19`): AI reads, the engine computes.

_Other engineering lessons (state/async UI, supply-chain safety, testing) to be
added as specific references are inspected in a later pass._
