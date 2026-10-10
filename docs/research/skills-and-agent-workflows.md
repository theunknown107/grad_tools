# Skills & agent workflows

**Inspected 2026-10-09 (bounded).**

## Resolved

- **Apple design skill** → the **installed** `~/.claude/skills/apple-design/SKILL.md`
  (read locally). Apple fluid-interface principles translated to the web. No
  install needed; already available. → Adapt.
- **UI Skills** (https://ui-skills.com/, gh `ibelick/ui-skills`, 9.4k★) → a
  curated **directory of design-engineering agent skills** from many authors
  (ibelick, anthropics, shadcn, emilkowalski, …). Access via `npx ui-skills` or
  MCP. Site licence not stated; each skill has its own. → Reference
  (skill-discovery), vet each before use.
- **User Interface Wiki** (gh `raphaelsalaja/userinterface-wiki`) → demos + a
  skill section. → Reference.

## Unresolved

- **Agricidaniel "Compass" repo** — no repository found under that owner; search
  returned only unrelated Compass projects. **Not guessed.** Needs a canonical
  URL from the user before evaluation.

## Rules before installing ANY skill (brief Phase 1C / Phase 6)

- "Skill" ≠ a URL, MCP server, slash command, `CLAUDE.md`, or npm package —
  confirm what it actually is.
- Inspect entry point/frontmatter, scripts/resources, triggering scope, Claude
  Code compatibility, global-vs-project scope, and conflicts with existing rules.
- Review source, licence, behaviour first. **Do not run remote install scripts
  blindly.** Prefer official/well-maintained sources.

## Critical: this environment already has a large curated skill set

`~/.claude/CLAUDE.md` holds a global routing registry over many installed skills
(shadcn, frontend-design, ui-ux-pro-max, design-taste-frontend, apple-design,
motion-design-skills, logo-design, document-skills, academic-research-skills, …).
Its own standing rule is **verify-before-install, no duplication, reuse what's
installed.** Any "new" skill from UI Skills or elsewhere must be checked against
that set for overlap first; most UI/design needs are already covered. → Treat
UI Skills as a catalogue to consult, not a thing to bulk-install.
