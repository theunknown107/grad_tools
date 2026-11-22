<!--
PROPOSAL ONLY. On approval, write the content between the `=== BEGIN/END ===`
markers (the frontmatter + body) to ~/.claude/skills/research-first/SKILL.md.
=== BEGIN SKILL.md ===
-->
---
name: research-first
description: Consult the curated cross-project research knowledge base before planning a new project or non-trivial feature; pick only domain-relevant resources, revalidate them against live sources, and map findings to Adopt/Adapt/Reference/Defer/Reject. Use when starting or planning a project, choosing UI libraries, design systems, LLM providers, animation, or agent skills, or when asked "what should we use for X" / "research the options for X". Not for small, well-scoped edits where the full workflow is disproportionate.
---

# Research-first project startup

A reusable, stack-agnostic workflow for choosing tools and patterns with evidence
instead of habit. It is an aid — precedence is always: system/safety → the user's
current instruction → the project's own rules → this workflow + knowledge base →
external recommendations.

## Knowledge base

- Global, generic: `~/.claude/knowledge/research-registry/` — canonical links,
  verification status, and generic findings. **Check the path exists first.**
- Project-specific: the current repo's `docs/research/` (if present) — the
  decision matrix mapped to this codebase.

If neither exists yet, proceed from first principles and *create* a project
`docs/research/` as you go.

## Workflow

1. **Orient.** Inspect cwd, `git status` (preserve existing/uncommitted work),
   the actual stack, architecture, constraints, and the project's own design
   system + UI/UX rules. Read them before proposing anything.
2. **Select, don't dump.** Read the registry; shortlist only resources relevant
   to this project's domain and stack. Relevance is decided per project.
3. **Revalidate.** Before relying on any external resource, re-check it live —
   model ids, free tiers, licences, maintenance, and install steps drift. Prefer
   primary sources (repos, docs, source files) over social posts. Mark anything
   inaccessible or ambiguous as unresolved; never guess an identity.
4. **Licence & safety.** Verify licences before copying code/assets. Don't run
   remote install scripts blindly. Never send secrets or private/user data to a
   third party to "test" it.
5. **Compatibility.** Prefer existing dependencies and the existing design system.
   No competing general-purpose component library; no gratuitous motion/assets;
   no new LLM provider or paid service without explicit approval.
6. **Decide & plan.** Map each candidate to Adopt / Adapt / Reference / Defer /
   Reject with a one-line reason and a source link. Present a short plan; get
   approval for anything significant or outward-facing.
7. **Implement in slices**, test, then **update the knowledge base** (project
   `docs/research/` + the generic parts of the global registry), re-dating rows.

## Lightweight mode

For a small, well-scoped task, skip the full pass: check the registry for a
directly relevant row, revalidate just that, and proceed. Don't research the
whole catalogue to make a one-file change.

## Decision vocabulary

**Adopt** (implement) · **Adapt** (use, modified to fit) · **Reference**
(inspiration only, no code) · **Defer** (promising, not yet justified) ·
**Reject** (unsuitable/insecure/duplicative — record the reason; don't
reintroduce without new evidence).

<!--
=== END SKILL.md ===
-->
