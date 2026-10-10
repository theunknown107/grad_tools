<!--
PROPOSAL ONLY. This is the exact block to APPEND to the end of
~/.claude/CLAUDE.md (never overwrite the existing 130 lines). Everything between
the two `=== BEGIN/END ===` markers is the literal text to append.
=== BEGIN APPEND ===
-->

---

# RESEARCH-FIRST PROJECT STARTUP (global, portable)

Before planning implementation for a **new** software project or a non-trivial
new feature — in any language or stack — consult the curated research knowledge
base instead of choosing tools from memory. This is a research **aid**, never an
override.

**Precedence:** system/safety → the user's current instruction → the project's
own rules, architecture and design system → this global workflow + knowledge
base → external recommendations. The knowledge base never overrides a project's
constraints or the user's instruction, and never authorises an unrequested change.

**Knowledge store** (verify the path exists before relying on it):
`~/.claude/knowledge/research-registry/` — canonical links, verification status,
and *generic* findings for evaluated UI / LLM / design / skill resources.
Project-specific decision matrices live in each project's own `docs/research/`.

**Before writing code on a new project:**
1. Inspect cwd, git status (preserve existing work), the real stack/architecture/
   constraints, and the project's own design system + UI/UX rules.
2. Read the knowledge registry; select **only** resources relevant to this
   project's domain and stack. Relevance is per-project — never adopt everything.
3. **Revalidate live** before relying on any external resource (model ids, free
   tiers, licences, install steps drift); update its registry row's date.
4. Prefer existing project dependencies and the existing design system over new
   ones. No competing component library, no gratuitous motion/assets, and no new
   LLM provider or paid service without explicit approval.
5. Produce a short, evidence-linked plan mapping findings to Adopt / Adapt /
   Reference / Defer / Reject; implement in reviewable slices; then update the
   knowledge base with anything newly learned.

For small, well-scoped tasks use a lightweight version — do not research the whole
catalogue. The reusable workflow is the `research-first` skill.

<!--
=== END APPEND ===
Diff summary: +~34 lines appended to ~/.claude/CLAUDE.md. No existing line changed
or removed. Reversible by deleting the appended block or restoring the backup.
-->
