"""
Bounded OCR recovery — opt-in (`recovery=True`), always flagged for review.

Each rule exists because the OCR survey (tests/ocr_corpus.py) measured a real
failure in the strict parser, and each is CONTEXT-BOUND: it fires only on the
token shape where the confusion occurs, never as a global character swap.

  1. Dictionary course-code tokens. `BCS5O2`, `BCS-502`, `BCS 502`, `BCSSO2`
     fail the course-code shape, so the row is not seen as a new subject and is
     appended to the PREVIOUS subject's title — breaking two subjects. Repaired
     only at the start of a dictionary row, only in the 3-character number run,
     only O/o→0, I/l→1, S→5, Z→2, and only if a real digit is already present.
     A real digit is never changed (BCB501 can never become BCB511).
  2. Dictionary honorifics. `Pr0f.` / `Dr,` are not recognised as faculty, so
     the name leaks into the title and its initialism breaks.
  3. Grid cells (applied only if the repaired abbreviation then RESOLVES and
     the printed one does not): trailing junk punctuation (`CN,` `CN/`), single
     letters spaced apart (`C N` — otherwise read as an "activity"), digit or
     lowercase-l confusables inside an abbreviation (`T0C`, `RMP1R`, `RMPlR`),
     and a glued LAB suffix (`CSLLAB`) — only when the prefix resolves to a
     subject whose own title is a Lab, so `MATLAB` can never become `MAT`.
  4. One ADJACENT TRANSPOSITION off exactly one subject (`RMPIR` vs RMIPR —
     the real Semester-5 document prints both). Extends the existing `near`
     tier: same length >= 4, unique, offered with a reason, never "identified".

Never: generic edit distance, prefix/substring matching, resolving an
AMBIGUOUS cell, overriding the document's own declaration, or any network.
"""

from __future__ import annotations

import re
from dataclasses import replace

from .dictionary import (
    COURSE_CODE,
    DictionaryRow,
    LayoutRow,
    Resolution,
    _candidates_from,
    resolve_grid_subject,
)

_CODE_LIKE = re.compile(r"^(\s*)(1?B[A-Z]{2,6})[\s-]?([0-9OoIlSZ]{3})([A-Z]?)(?=\s|-|$)")
_DIGIT_FOR = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "S": "5", "Z": "2"})
_HONORIFIC = [
    (re.compile(r"\bPr[0o]f\b\.?"), "Prof."),
    (re.compile(r"\bDr[,;]"), "Dr."),
]
_TRAILING_JUNK = re.compile(r"[,;:/\\|'\"`!?]+$")
_SPACED_LETTERS = re.compile(r"^(?:[A-Z] ){1,5}[A-Z]$")
_LETTER_FOR = str.maketrans({"0": "O", "1": "I", "5": "S", "8": "B", "l": "I"})
_GLUED_LAB = re.compile(r"^([A-Z]{2,6})LAB$")


def _repair_code_token(row: str) -> tuple[str, str | None, str | None]:
    """(repaired row, printed token, repaired code) — or the row unchanged."""
    if COURSE_CODE.search(row):
        return row, None, None
    match = _CODE_LIKE.match(row)
    if match is None or not re.search(r"[0-9]", match.group(3)):
        return row, None, None
    code = f"{match.group(2)}{match.group(3).translate(_DIGIT_FOR)}{match.group(4)}"
    if not COURSE_CODE.fullmatch(code) or not re.search(r"[A-Za-z]{3,}", row[match.end():]):
        return row, None, None  # a code needs a title after it; a lone token is not a subject row
    printed = row[len(match.group(1)) : match.end()]
    return f"{match.group(1)}{code}{row[match.end():]}", printed, code


def _repair_honorifics(row: str) -> str:
    for pattern, fixed in _HONORIFIC:
        row = pattern.sub(fixed, row)
    return row


def repair_dictionary_rows(rows: list[str], layout: list[LayoutRow]) -> tuple[list[str], list[LayoutRow]]:
    repaired_rows: list[str] = []
    repaired_layout: list[LayoutRow] = []
    for text, line in zip(rows, layout):
        coded, printed, code = _repair_code_token(text)
        fixed = _repair_honorifics(coded)
        repaired_rows.append(fixed)
        if fixed == text:
            repaired_layout.append(line)
            continue
        # Keep the column geometry; repair the SAME printed tokens inside the runs.
        runs, code_done = [], printed is None
        for run in line.runs:
            run_text = run.text
            if not code_done and printed in run_text:
                run_text, code_done = run_text.replace(printed, code, 1), True
            runs.append(replace(run, text=_repair_honorifics(run_text)))
        repaired_layout.append(LayoutRow(y=line.y, runs=runs))
    return repaired_rows, repaired_layout


def mark_corrected(dictionary: list[DictionaryRow], original: list[str], repaired: list[str]) -> list[DictionaryRow]:
    changed = {repaired[i] for i in range(len(repaired)) if repaired[i] != original[i]}
    if not changed:
        return dictionary
    out = []
    for entry in dictionary:
        touched = any(entry.subject_code in row.replace(" ", "") for row in changed)
        out.append(replace(entry, ocr_corrected=True) if touched else entry)
    return out


def _swap_one(candidate: str, wanted: str) -> bool:
    if len(candidate) != len(wanted) or candidate == wanted:
        return False
    diffs = [i for i, (a, b) in enumerate(zip(candidate, wanted)) if a != b]
    return (
        len(diffs) == 2
        and diffs[1] == diffs[0] + 1
        and candidate[diffs[0]] == wanted[diffs[1]]
        and candidate[diffs[1]] == wanted[diffs[0]]
    )


def _bare_candidates(entry: DictionaryRow) -> list[str]:
    """
    Candidates from the title WITHOUT its parenthetical qualifier.

    `Computer Networks(T/L)` yields CN *and* CNTL; the qualifier letters are a
    fact about the course, not words of its name. Measured: CNTL put `CNLL` one
    letter from BCS502 and the strict `near` tier offered BCS502 for it — a
    wrong suggestion. The approximate tiers therefore compare against the bare
    title only; the EXACT tiers keep both readings, exactly as before.
    """
    bare = re.sub(r"\([^)]*\)", " ", entry.title)
    extra = [] if entry.initials is None else _candidates_from(f"{bare} {entry.initials}")
    return _candidates_from(bare) + extra


def _unknown(wanted: str) -> Resolution:
    return Resolution(None, "unknown", f'"{wanted}" is not defined anywhere on this timetable.')


def resolve_with_recovery(dictionary: list[DictionaryRow], initials: str) -> tuple[Resolution, bool]:
    """Strict resolution first; approximate tiers are re-checked against bare titles."""
    strict = resolve_grid_subject(dictionary, initials)
    wanted = initials.strip().upper()
    if strict.resolution == "near":
        one_off = lambda c: len(c) == len(wanted) and sum(a != b for a, b in zip(c, wanted)) == 1  # noqa: E731
        holders = [e for e in dictionary if any(one_off(c) for c in _bare_candidates(e))]
        if len(holders) != 1 or holders[0].subject_code != strict.subject_code:
            return _unknown(wanted), True  # only the qualifier made it "near": not evidence
    if strict.subject_code is not None:
        entry = next((e for e in dictionary if e.subject_code == strict.subject_code), None)
        return strict, bool(entry is not None and entry.ocr_corrected)
    if strict.resolution != "unknown":
        return strict, False  # ambiguity is the document's, never resolved by recovery

    if len(wanted) >= 4 and re.fullmatch(r"[A-Z]+", wanted):
        swapped = [e for e in dictionary if any(_swap_one(c, wanted) for c in _bare_candidates(e))]
        if len(swapped) == 1:
            entry = swapped[0]
            closest = next(c for c in _bare_candidates(entry) if _swap_one(c, wanted))
            return (
                Resolution(
                    entry.subject_code,
                    "near",
                    f'"{wanted}" is not in this timetable\'s subject list. The closest is "{closest}" '
                    f"({entry.subject_code}), two letters swapped — check it.",
                ),
                True,
            )
    return strict, False


def _resolves(dictionary: list[DictionaryRow], token: str) -> bool:
    return resolve_with_recovery(dictionary, token)[0].subject_code is not None


def repair_cell(text: str, dictionary: list[DictionaryRow]) -> str:
    """A repaired cell text, or the printed one when no rule both applies and helps."""
    if not dictionary or _resolves(dictionary, text) or " " in text.strip() and not _SPACED_LETTERS.match(text):
        return text

    candidates = []
    stripped = _TRAILING_JUNK.sub("", text).strip()
    if stripped != text:
        candidates.append(stripped)
    if _SPACED_LETTERS.match(stripped):
        candidates.append(stripped.replace(" ", ""))
    token = stripped.replace(" ", "") if _SPACED_LETTERS.match(stripped) else stripped
    if (
        re.fullmatch(r"[A-Z0-9l]{3,6}", token)
        and re.search(r"[A-Z]", token)
        and re.search(r"[0-9l]", token[:-1])  # a trailing digit may be a batch; leave it
    ):
        candidates.append(token.translate(_LETTER_FOR))
    glued = _GLUED_LAB.match(token)
    if glued:
        resolved = resolve_with_recovery(dictionary, glued.group(1))[0]
        entry = next((e for e in dictionary if e.subject_code == resolved.subject_code), None)
        if entry is not None and re.search(r"\blab\b", entry.title, re.IGNORECASE):
            candidates.append(glued.group(1))

    for candidate in candidates:
        if candidate != text and _resolves(dictionary, candidate):
            return candidate
    return text
