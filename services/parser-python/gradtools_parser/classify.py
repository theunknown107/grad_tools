"""
What kind of academic document is this? Deterministic, evidence-weighted.

Faithful port of `classifyDocument` (apps/web/src/domain/document-type.ts):
each type accumulates weighted signals, the winner must clear a floor (6 — no
single signal can carry a document) and beat the runner-up by a margin (2).
An exam schedule and a question paper are scored separately and outrank the
generic readings once they clear the floor. An ACADEMIC_CALENDAR is never read
as a timetable just because it prints weekday names. Offline: regex over text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .models import DocumentType


@dataclass(frozen=True)
class Signal:
    name: str
    pattern: re.Pattern[str]
    weight: int


def _sig(name: str, pattern: str, weight: int, flags: int = re.IGNORECASE) -> Signal:
    return Signal(name, re.compile(pattern, flags), weight)


_IS = re.IGNORECASE | re.DOTALL

RESULT_SIGNALS = [
    _sig("seat number", r"university\s+seat\s+number", 3),
    _sig("provisional results heading", r"provisional\s+results?", 3),
    _sig("internal marks column", r"internal\s+marks", 3),
    _sig("external marks column", r"external\s+marks", 3),
    _sig("announced/updated column", r"announced\s*/?\s*updated", 2),
    _sig("a pass/fail legend", r"\bP\s*->\s*PASS\b", 2),
]

CALENDAR_SIGNALS = [
    _sig("academic calendar heading", r"academic\s+calendar", 4),
    _sig("calendar of events", r"calendar\s+of\s+events", 4),
    _sig("commencement of the term", r"commencement\s+of\s+(the\s+)?(class|semester|term)", 3),
    _sig("last working day", r"last\s+working\s+day", 3),
    _sig("registration window", r"(registration|enrol?ment)\s+(of|for|last|closes|deadline|date)", 2),
    _sig("odd/even semester naming", r"\b(odd|even)\s+semester\b", 2),
    _sig("an academic year", r"\b20\d{2}\s*[-–—/]\s*(20)?\d{2}\b", 1, 0),
]

TIMETABLE_SIGNALS = [
    _sig("weekday columns", r"monday.*tuesday|tuesday.*wednesday", 4, _IS),
    _sig("with effect from", r"\bw\.?\s*e\.?\s*f\.?\b", 2),
    _sig("a time-of-day grid", r"\b\d{1,2}[:.]\d{2}\s*(am|pm)?\s*[-–—to]+\s*\d{1,2}[:.]\d{2}", 3),
    _sig("time table heading", r"time\s*table", 2),
    _sig("a lunch or break row", r"\b(lunch|break|recess)\b", 1),
]

SCHEME_SIGNALS = [
    _sig("scheme of teaching heading", r"scheme\s+of\s+teaching(\s+and\s+examinations?)?", 4),
    _sig("teaching hours per week", r"teaching\s+hours?\s*/?\s*week", 3),
    _sig("a course code column", r"course\s+code", 2),
    _sig("a credits column", r"\bcredits?\b", 1),
    _sig("choice based credit system", r"choice\s+based\s+credit\s+system", 2),
    _sig("outcome based education", r"outcome\s+based\s+education", 2),
]

EXAM_SCHEDULE_SIGNALS = [
    _sig("examination time table", r"time\s*table\s+for\s+.*examination|examination.*time\s*table", 4, _IS),
    _sig("draft schedule", r"\bdraft\s+time\s*table\b", 3),
    _sig("a date/day column", r"\bdate\s*,\s*day\b", 3),
    _sig("registrar (evaluation)", r"registrar\s*\(\s*evaluation\s*\)", 3),
]

QUESTION_PAPER_SIGNALS = [
    _sig("marks-per-question column", r"\bmarks\b.*\bmodule\b|\bmodule\s*-?\s*[1-5]\b", 3, _IS),
    _sig("answer instructions", r"answer\s+any\s+(one|two|five|full)", 4),
    _sig("USN grid", r"\bUSN\b", 1, 0),
    _sig("maximum marks", r"max\.?\s*marks", 3),
]

SCHEME_GATE = "scheme of teaching heading"
MINIMUM = 6
MARGIN = 2

NOT_ACADEMIC = (
    "GradTools could not identify this as a result card, an academic calendar or a class timetable. "
    "If it is one, a clearer scan may work — or you can enter the details by hand."
)

# TS type names, kept for adapter/parity: 'result' | 'academic_calendar' | ...
TS_TYPE = {
    DocumentType.RESULT: "result",
    DocumentType.ACADEMIC_CALENDAR: "academic_calendar",
    DocumentType.TIMETABLE: "college_timetable",
    DocumentType.EXAM_TIMETABLE: "exam_timetable",
    DocumentType.COURSE_SCHEME: "course_scheme",
    DocumentType.UNKNOWN: "unsupported",
}


@dataclass(frozen=True)
class Classification:
    document_type: DocumentType
    reason: str
    signals: list[str] = field(default_factory=list)

    @property
    def ts_type(self) -> str:
        return TS_TYPE[self.document_type]


def _score(text: str, signals: list[Signal]) -> tuple[int, list[str]]:
    hits = [s for s in signals if s.pattern.search(text)]
    return sum(s.weight for s in hits), [s.name for s in hits]


def classify(lines: list[str]) -> Classification:
    if not lines:
        return Classification(DocumentType.UNKNOWN, "Nothing could be read from this file.", [])

    text = "\n".join(lines)
    scheme_total, scheme_names = _score(text, SCHEME_SIGNALS)
    if SCHEME_GATE not in scheme_names:
        scheme_total = 0
    candidates = [
        (DocumentType.RESULT, *_score(text, RESULT_SIGNALS)),
        (DocumentType.ACADEMIC_CALENDAR, *_score(text, CALENDAR_SIGNALS)),
        (DocumentType.TIMETABLE, *_score(text, TIMETABLE_SIGNALS)),
        (DocumentType.COURSE_SCHEME, scheme_total, scheme_names),
    ]
    exam_total, exam_names = _score(text, EXAM_SCHEDULE_SIGNALS)
    paper_total, paper_names = _score(text, QUESTION_PAPER_SIGNALS)

    ranked = sorted(candidates, key=lambda c: c[1], reverse=True)  # stable, like Array.sort
    best, runner_up = ranked[0], ranked[1]

    if exam_total >= MINIMUM:
        return Classification(
            DocumentType.EXAM_TIMETABLE,
            "This looks like an examination time table — dated papers with sitting times, "
            "rather than a shape that repeats every week.",
            exam_names,
        )
    if paper_total >= MINIMUM:
        return Classification(
            DocumentType.UNKNOWN,
            "This looks like a question paper. GradTools does not read question papers.",
            paper_names,
        )
    if best[1] < MINIMUM:
        return Classification(DocumentType.UNKNOWN, NOT_ACADEMIC, best[2])
    if best[1] - runner_up[1] < MARGIN:
        return Classification(
            DocumentType.UNKNOWN,
            "This document could be more than one kind of academic record, so GradTools has not guessed. "
            "You can enter what you need by hand.",
            best[2] + runner_up[2],
        )
    reason = {
        DocumentType.RESULT: "This looks like a result card.",
        DocumentType.TIMETABLE: "This looks like a class timetable.",
    }.get(best[0], "This looks like an academic calendar.")
    return Classification(best[0], reason, best[2])
