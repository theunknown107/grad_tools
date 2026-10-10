"""
One document in, one structured answer out: classify, then route.

Only a document classified TIMETABLE reaches the grid parser. An academic
calendar (or anything else) returns its type and no timetable entries — a
calendar that prints weekday names is never read as a week.
"""

from __future__ import annotations

import re

from .classify import classify
from .layout import Placed, collapse, median_height, rows_of
from .models import (
    ActivityType,
    DictionaryEntry,
    DocumentMetadata,
    DocumentType,
    ParsedDocument,
    ParseError,
    ReviewReason,
    TimetableEntry,
)
from .timetable import GridClass, ParsedTimetable, parse_timetable

# Extraction confidence per resolution tier: how directly the DOCUMENT pinned
# the code — a tier label rendered as a number, not a probability.
TIER_CONFIDENCE = {
    "declared": 1.0, "initialism": 0.9, "activity": 0.8, "near": 0.5, "ambiguous": 0.2, "unknown": 0.0,
}


def lines_of(placed: list[Placed]) -> list[str]:
    """The page's printed lines, rebuilt the same way the grid parser rows it."""
    if not placed:
        return []
    rows = rows_of(placed, median_height(placed) * 0.6)
    return [collapse(" ".join(item.text for item in row)).strip() for row in rows]


def _activity_type(entry: GridClass, title: str | None) -> ActivityType:
    label = f"{title or ''} {entry.initials}".lower()
    if re.search(r"mini\s*project", label):
        return ActivityType.MINI_PROJECT
    if re.search(r"value\s*add", label):
        return ActivityType.VALUE_ADDED
    if re.search(r"soft\s*skill", label):
        return ActivityType.SOFT_SKILLS
    if entry.shape in ("split", "lab") or re.search(r"\blab\b", label):
        return ActivityType.LAB
    if entry.resolution == "activity":
        return ActivityType.ACTIVITY
    if entry.subject_code is not None:
        return ActivityType.SUBJECT
    return ActivityType.UNKNOWN


def _review_reasons(entry: GridClass, conflicted: bool) -> list[ReviewReason]:
    reasons = {
        "unknown": [ReviewReason.UNKNOWN_SUBJECT_INITIAL],
        "ambiguous": [ReviewReason.AMBIGUOUS_SUBJECT],
        "near": [ReviewReason.NEAR_MATCH_NEEDS_CHECK],
    }.get(entry.resolution, [])
    if entry.ocr_recovered:
        reasons = reasons + [ReviewReason.OCR_RECOVERED]
    if conflicted:
        reasons = reasons + [ReviewReason.DUPLICATE_OR_REPEATED_ENTRY]
    return reasons


def from_grid(grid: ParsedTimetable) -> tuple[DocumentMetadata, list[TimetableEntry], list[DictionaryEntry]]:
    titles = {row.subject_code: row for row in grid.dictionary}
    conflicted = {(k.day, k.start, k.batch) for k in grid.conflicts}
    declared_initials = any(row.initials is not None for row in grid.dictionary)

    metadata = DocumentMetadata(
        semester=grid.context.semester,
        division=grid.context.division,
        class_name=grid.context.class_name,
        revision=grid.context.revision,
        academic_year=grid.context.academic_year,
        effective_date=grid.context.effective_from,
        room=grid.context.room,
        layout_family="grid:declared-initials" if declared_initials else "grid:derived-initials",
    )

    entries: list[TimetableEntry] = []
    for slot in grid.slots:
        if slot.is_break:
            kind = ActivityType.LUNCH if slot.break_kind == "LUNCH" else ActivityType.BREAK
            entries.append(
                TimetableEntry(start_time=slot.start, end_time=slot.end, activity_type=kind, confidence=1.0)
            )
    for entry in grid.classes:
        row = titles.get(entry.subject_code) if entry.subject_code else None
        reasons = _review_reasons(entry, (entry.day, entry.start, entry.batch) in conflicted)
        entries.append(
            TimetableEntry(
                day=entry.day,
                start_time=entry.start,
                end_time=entry.end,
                subject_initial=entry.initials,
                course_code=entry.subject_code,
                course_title=row.title if row else None,
                room=entry.room if entry.room is not None else grid.context.room,
                instructor=row.faculty if row else None,
                activity_type=_activity_type(entry, row.title if row else None),
                batch=entry.batch,
                resolution=entry.resolution,
                spans_slots=entry.spans_slots,
                source_text=entry.source_text,
                confidence=TIER_CONFIDENCE.get(entry.resolution, 0.0) * (0.5 if entry.ocr_recovered else 1.0),
                needs_review=bool(reasons),
                review_reasons=reasons,
            )
        )

    # The document-local dictionary, keyed by code, with the grid abbreviation(s)
    # the document itself used for it.
    used: dict[str, str] = {}
    for entry in grid.classes:
        if entry.subject_code and entry.resolution in ("declared", "initialism"):
            used.setdefault(entry.subject_code, entry.initials)
    dictionary = [
        DictionaryEntry(
            initial=row.initials or used.get(row.subject_code) or "",
            course_code=row.subject_code,
            course_title=row.title,
            instructor=row.faculty,
        )
        for row in grid.dictionary
    ]
    return metadata, entries, dictionary


def parse_document(
    placed: list[Placed], lines: list[str] | None = None, recovery: bool = False
) -> ParsedDocument:
    classification = classify(lines if lines is not None else lines_of(placed))
    document = ParsedDocument(
        document_type=classification.document_type,
        classification_reason=classification.reason,
        classification_signals=list(classification.signals),
    )
    if classification.document_type is DocumentType.ACADEMIC_CALENDAR:
        document.metadata = DocumentMetadata(layout_family="calendar")
        return document
    if classification.document_type is not DocumentType.TIMETABLE:
        if classification.document_type is DocumentType.UNKNOWN:
            document.errors.append(ParseError.DOCUMENT_TYPE_UNKNOWN)
        return document

    grid = parse_timetable(placed, recovery=recovery)
    document.metadata, document.timetable, document.dictionary = from_grid(grid)
    document.warnings = list(grid.warnings)
    if not grid.slots:
        document.errors.append(ParseError.TIME_HEADER_NOT_FOUND)
    if not grid.dictionary:
        document.errors.append(ParseError.SUBJECT_DICTIONARY_NOT_FOUND)
    if grid.slots and not grid.coverage.looks_complete:
        document.errors.append(ParseError.PARTIAL_PARSE)
    return document
