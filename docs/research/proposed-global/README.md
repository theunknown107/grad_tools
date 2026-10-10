# Proposed global Claude Code configuration (NOT yet applied)

These are **proposals for review**. Nothing here has been written to `~/.claude`.
The only change made to the global area this session is a **backup**:
`~/.claude/backups/CLAUDE.md.20261009-183246.bak` (a copy; the active file is
unchanged at 130 lines).

Environment verified: **Claude Code 2.1.294**. Supported persistence mechanisms:
- **User `~/.claude/CLAUDE.md`** — auto-loaded into every session as global
  instructions. Already exists (130 lines). We **append** a concise block; never
  overwrite.
- **User skills `~/.claude/skills/<name>/SKILL.md`** — loaded on trigger by the
  skill's `description`. Same format as the installed skills (e.g. `apple-design`).
- **A plain knowledge directory** under `~/.claude/` — not auto-loaded, but
  readable on demand by the skill and pointed to from `CLAUDE.md`. This is where
  detailed notes live so the global instructions stay small.

## What to apply, on your approval

| # | Target path | Action | Source in this repo |
|---|---|---|---|
| 1 | `~/.claude/CLAUDE.md` | **Append** the block (don't overwrite) | [`CLAUDE.md-addition.md`](./CLAUDE.md-addition.md) |
| 2 | `~/.claude/skills/research-first/SKILL.md` | Create new skill | [`research-first-SKILL.md`](./research-first-SKILL.md) |
| 3 | `~/.claude/knowledge/research-registry/` | Create dir + a **generalized** registry (links, status, generic findings — no project specifics) | generated from [`../research-registry.md`](../research-registry.md) at apply time |

## How future sessions load these

- The appended `CLAUDE.md` block loads **every session, every project** — it tells
  the agent to consult the knowledge base before planning a new project and to
  revalidate sources.
- The `research-first` skill loads **when its description matches** (starting/
  planning a project, choosing UI libs / design systems / LLM providers / skills).
- The knowledge directory is **read on demand** by the skill / the pointer — it is
  not auto-injected, which keeps global context small.

## Division: global vs. project-specific

- **Global** (portable, reusable across languages/stacks): the workflow, the
  precedence rules, the resource list with canonical links + verification status +
  *generic* findings, and the revalidate-before-use discipline.
- **Project-specific** (stays in each repo's `docs/research/`): the decision
  **matrix** that maps findings to *this* codebase (e.g. GradTools' Shadcn-only
  rule, its AI router). Not copied to the global store.

## Backup & rollback

- **Backup (already done this session):** `~/.claude/CLAUDE.md` →
  `~/.claude/backups/CLAUDE.md.20261009-183246.bak`. Keep it intact.
- **Before applying,** re-copy the live `CLAUDE.md` to a fresh timestamped
  `.bak` (it may have changed since).
- **Rollback of the CLAUDE.md append:** delete the appended block (everything
  from the `# RESEARCH-FIRST PROJECT STARTUP` heading to end), or restore the
  backup: `cp ~/.claude/backups/CLAUDE.md.<ts>.bak ~/.claude/CLAUDE.md`.
- **Rollback of the skill:** `rm -r ~/.claude/skills/research-first`.
- **Rollback of the knowledge store:** `rm -r ~/.claude/knowledge/research-registry`.
- All three are additive and independently reversible; no existing file is
  overwritten (CLAUDE.md is appended-to only).

## Maintenance procedure (proposed)

1. New finding → update the project's `docs/research/` first (with evidence +
   date), then reflect any *generalizable* part in the global registry.
2. Re-date a registry row whenever its source is re-checked; treat rows older
   than ~30 days as stale and revalidate before use.
3. Never delete an unresolved/inaccessible reference — keep it with its status.
4. Before editing `~/.claude/CLAUDE.md`, back it up to `~/.claude/backups/`
   (as done this session) and make minimal, additive edits only.

## Honesty note

Global persistence is **proposed, not configured.** Until you approve and these
files are written to `~/.claude/`, no global memory/skill exists beyond the
project-local `docs/research/` and this proposal.
