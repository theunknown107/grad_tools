"""
The timetable's own vocabulary: the subject table, and how a grid abbreviation
is resolved through it.

Port of `readDictionary`, `initialismsFor` and `resolveGridSubject`
(apps/web/src/domain/timetable-import.ts). Resolution order, not negotiable:

  1. the document's declaration (a cell spelling a title, or a declared
     initials column),
  2. a UNIQUE title initialism (closed candidate set, exact hit),
  3. one letter off exactly one subject (`near` — has a code, flagged),
  4. nothing: `ambiguous` (names the candidates) or `unknown`.

No generic abbreviation table exists anywhere: `CN` means whatever THIS
document's subject table says, or nothing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .layout import Placed, collapse

COURSE_CODE = re.compile(r"\b(1?B[A-Z]{2,6}\d{3}[A-Z]?)\b")
COURSE_CODE_ALL = re.compile(r"\b1?B[A-Z]{2,6}\d{3}[A-Z]?\b")
HOURS = re.compile(r"\b(\d)\s*\+\s*(\d)\s*\+\s*(\d)\b")
FACULTY = re.compile(r"\b(?:prof|dr|adv|mr|ms|mrs)\s*\.?\s+[A-Za-z][A-Za-z. ]{1,40}", re.IGNORECASE)
_ADMIN_TOKEN = re.compile(r"^(LAB|VTU|CSE|ECE|ISE|AIML|CSBS)$", re.IGNORECASE)
_UPPER_TOKEN = re.compile(r"\b[A-Z]{2,6}\b")
_CONTACT = re.compile(r"\b\d{5,}\b")
_LEADING_PUNCT = re.compile(r"^[\s\-–—:/]+")


def subject_key(code: str) -> str:
    return re.sub(r"\s+", "", code).upper()


@dataclass(frozen=True)
class DictionaryRow:
    """One row of the subject table (TS `DictionaryEntry`)."""

    subject_code: str
    title: str
    initials: str | None
    faculty: str | None
    college_hours: str | None
    scheme_hours: str | None
    ocr_corrected: bool = False  # recovery mode only; never true in strict mode


@dataclass(frozen=True)
class LayoutRow:
    y: float
    runs: list[Placed]


def read_dictionary(rows: list[str], layout: list[LayoutRow] | None = None) -> list[DictionaryRow]:
    steps = []
    if layout is not None:
        for index in range(1, len(layout)):
            step = layout[index - 1].y - layout[index].y
            if step > 0:
                steps.append(step)
    sorted_steps = sorted(steps)
    median_step = 0.0 if not sorted_steps else sorted_steps[len(sorted_steps) // 2]

    def section_break(index: int) -> bool:
        if layout is None or median_step == 0 or index == 0:
            return False
        return (layout[index - 1].y - layout[index].y) > median_step * 1.8

    blocks: list[list[int]] = []
    open_block = False
    for index, row in enumerate(rows):
        if COURSE_CODE.search(row):
            blocks.append([index])
            open_block = True
            continue
        if not open_block:
            continue
        if section_break(index):
            open_block = False
            continue
        blocks[-1].append(index)

    # The name column ends where the second printed run of a block head begins.
    name_starts = [
        layout[block[0]].runs[1].x
        for block in blocks
        if layout is not None and len(layout[block[0]].runs) > 1
    ]
    name_right = min(name_starts) if name_starts else float("inf")

    def name_column(index: int) -> str:
        if layout is None:
            return rows[index]
        return collapse(" ".join(run.text for run in layout[index].runs if run.x < name_right)).strip()

    def candidate_for(head: str, code: str) -> str | None:
        after = head[head.index(code) + len(code):]
        for token in _UPPER_TOKEN.findall(after):
            if not COURSE_CODE.search(token) and not _ADMIN_TOKEN.match(token):
                return token
        return None

    coded = []
    for block in blocks:
        head = rows[block[0]]
        match = COURSE_CODE.search(head)
        if match is not None:
            coded.append((block, head, match.group(1)))

    filled_rows = sum(1 for _, head, code in coded if candidate_for(head, code) is not None)
    column_is_filled = len(coded) > 0 and filled_rows * 2 > len(coded)

    def strip_admin(text: str) -> str:
        out = text
        faculty = FACULTY.search(out)
        if faculty is not None:
            faculty_at = faculty.start()
            groups = list(HOURS.finditer(out))
            last_end = groups[-1].end() if groups else -1
            out = f"{out[:faculty_at]} {out[last_end:]}" if last_end > faculty_at else out[:faculty_at]
        out = FACULTY.sub(" ", out)
        out = HOURS.sub(" ", out)
        out = _CONTACT.sub(" ", out)
        return collapse(out).strip()

    entries: list[DictionaryRow] = []
    for block, head, code in coded:
        after = head[head.index(code) + len(code):]
        declared = candidate_for(head, code) if column_is_filled else None

        named = name_column(block[0])
        # Faithful to TS `named.slice(named.indexOf(code) + (included ? len : 0))`,
        # which yields the LAST character when the code is absent (indexOf = -1).
        named_after = named[named.index(code) + len(code):] if code in named else named[-1:]

        title_parts = [strip_admin(named_after)] if declared is None else [after[: after.find(declared)]]
        for index in block[1:]:
            title_parts.append(strip_admin(name_column(index) if declared is None else rows[index]))

        title = " ".join(part for part in title_parts if part != "")
        title = COURSE_CODE_ALL.sub(" ", title)
        title = _LEADING_PUNCT.sub("", title, count=1)
        title = collapse(title).strip()

        joined = " ".join(rows[index] for index in block)
        hours = [re.sub(r"\s+", "", match.group(0)) for match in HOURS.finditer(joined)]
        faculty = FACULTY.search(joined)

        entries.append(
            DictionaryRow(
                subject_code=subject_key(code),
                title=title,
                initials=declared.upper() if declared is not None else None,
                faculty=collapse(faculty.group(0)).strip() if faculty is not None else None,
                college_hours=hours[0] if len(hours) > 0 else None,
                scheme_hours=hours[1] if len(hours) > 1 else None,
            )
        )
    return entries


# --------------------------------------------------------------------------- #
# Initialisms: a closed, rule-generated candidate set — NOT fuzzy matching.   #
# --------------------------------------------------------------------------- #

SKIPPABLE = {"of", "and", "the", "for", "in", "to", "with", "a", "an", "&"}


def _candidates_from(title: str) -> list[str]:
    words = [part for word in re.split(r"[^A-Za-z0-9&-]+", title) for part in word.split("-") if part != ""]
    if not words:
        return []

    def build(skip_joiners: bool) -> str:
        out = ""
        for word in words:
            if skip_joiners and word.lower() in SKIPPABLE:
                continue
            # An acronym already in the title is carried whole.
            out += word if len(word) > 1 and word == word.upper() else word[0]
        return out.upper()

    return [value for value in dict.fromkeys([build(True), build(False)]) if len(value) >= 2]


def initialisms_for(title: str) -> list[str]:
    """Every abbreviation a title could reasonably have been shortened to; a
    parenthetical qualifier (`Computer Networks(T/L)`) is tried both ways."""
    bare = re.sub(r"\([^)]*\)", " ", title)
    return list(dict.fromkeys(_candidates_from(title) + _candidates_from(bare)))


@dataclass(frozen=True)
class Resolution:
    subject_code: str | None
    resolution: str  # declared | initialism | near | ambiguous | activity | unknown
    reason: str | None


def _candidates(entry: DictionaryRow) -> list[str]:
    extra = [] if entry.initials is None else initialisms_for(f"{entry.title} {entry.initials}")
    return initialisms_for(entry.title) + extra


def resolve_grid_subject(dictionary: list[DictionaryRow], initials: str) -> Resolution:
    wanted = initials.strip().upper()
    if wanted == "":
        return Resolution(None, "unknown", "The cell is empty.")

    spelled = [entry for entry in dictionary if collapse(entry.title).strip().upper() == wanted]
    if len(spelled) == 1:
        return Resolution(spelled[0].subject_code, "declared", None)

    declared = [entry for entry in dictionary if entry.initials == wanted]
    if len(declared) == 1:
        return Resolution(declared[0].subject_code, "declared", None)

    derived = [entry for entry in dictionary if wanted in _candidates(entry)]
    if len(derived) == 1:
        return Resolution(derived[0].subject_code, "initialism", None)
    if len(derived) > 1:
        codes = " or ".join(entry.subject_code for entry in derived)
        return Resolution(None, "ambiguous", f'"{wanted}" could be {codes} — this timetable does not say which.')

    if len(wanted) >= 4 and re.fullmatch(r"[A-Z]+", wanted):
        def one_off(candidate: str) -> bool:
            return len(candidate) == len(wanted) and sum(a != b for a, b in zip(candidate, wanted)) == 1

        near = [entry for entry in dictionary if any(one_off(c) for c in _candidates(entry))]
        if len(near) == 1:
            entry = near[0]
            closest = next((c for c in _candidates(entry) if one_off(c)), "")
            return Resolution(
                entry.subject_code,
                "near",
                f'"{wanted}" is not in this timetable\'s subject list. The closest is "{closest}" '
                f"({entry.subject_code}), one letter different — check it.",
            )

    return Resolution(None, "unknown", f'"{wanted}" is not defined anywhere on this timetable.')
