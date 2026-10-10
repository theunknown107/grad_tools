"""
Canonical structured output for the offline Python parser.

Pure stdlib (dataclasses + enums), so the parser has ZERO third-party runtime
dependencies and therefore cannot make a network call at parse time. The image
/ OCR pipeline (OpenCV, PyMuPDF, a local OCR engine) is a separate, deferred
layer; those are the only places heavy deps would ever be added, and only as
explicit project dependencies provisioned at setup — never downloaded at parse
time. (Pydantic would be a drop-in for these models once that layer lands; the
field shapes are deliberately Pydantic-compatible.)

The shapes map cleanly onto the existing GradTools TypeScript types
(ParsedTimetable / GridClass / TimeSlot / SubjectResolution) via adapter.py —
they are not a blind copy of the whole domain model.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum

PARSER_VERSION = "python-offline-0.1.0"


class DocumentType(str, Enum):
    TIMETABLE = "TIMETABLE"
    ACADEMIC_CALENDAR = "ACADEMIC_CALENDAR"
    RESULT = "RESULT"
    EXAM_TIMETABLE = "EXAM_TIMETABLE"
    COURSE_SCHEME = "COURSE_SCHEME"
    UNKNOWN = "UNKNOWN"


class ActivityType(str, Enum):
    SUBJECT = "SUBJECT"
    LAB = "LAB"
    BREAK = "BREAK"
    LUNCH = "LUNCH"
    VALUE_ADDED = "VALUE_ADDED"
    MINI_PROJECT = "MINI_PROJECT"
    SOFT_SKILLS = "SOFT_SKILLS"
    ACTIVITY = "ACTIVITY"
    UNKNOWN = "UNKNOWN"


class ReviewReason(str, Enum):
    UNKNOWN_SUBJECT_INITIAL = "UNKNOWN_SUBJECT_INITIAL"
    UNRESOLVED_COURSE_CODE = "UNRESOLVED_COURSE_CODE"
    AMBIGUOUS_BATCH = "AMBIGUOUS_BATCH"
    AMBIGUOUS_TIME_RANGE = "AMBIGUOUS_TIME_RANGE"
    UNRECOGNIZED_ACTIVITY = "UNRECOGNIZED_ACTIVITY"
    DOCUMENT_TYPE_AMBIGUOUS = "DOCUMENT_TYPE_AMBIGUOUS"
    MERGED_CELL_UNCERTAIN = "MERGED_CELL_UNCERTAIN"
    OCR_LOW_CONFIDENCE = "OCR_LOW_CONFIDENCE"
    AMBIGUOUS_SUBJECT = "AMBIGUOUS_SUBJECT"
    NEAR_MATCH_NEEDS_CHECK = "NEAR_MATCH_NEEDS_CHECK"
    OCR_RECOVERED = "OCR_RECOVERED"
    DUPLICATE_OR_REPEATED_ENTRY = "DUPLICATE_OR_REPEATED_ENTRY"


class ParseError(str, Enum):
    INVALID_FILE = "INVALID_FILE"
    UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
    OCR_FAILURE = "OCR_FAILURE"
    DOCUMENT_TYPE_UNKNOWN = "DOCUMENT_TYPE_UNKNOWN"
    TIMETABLE_GRID_NOT_FOUND = "TIMETABLE_GRID_NOT_FOUND"
    TIME_HEADER_NOT_FOUND = "TIME_HEADER_NOT_FOUND"
    SUBJECT_DICTIONARY_NOT_FOUND = "SUBJECT_DICTIONARY_NOT_FOUND"
    AMBIGUOUS_ENTRY = "AMBIGUOUS_ENTRY"
    PARTIAL_PARSE = "PARTIAL_PARSE"


@dataclass
class TimetableEntry:
    day: str | None = None
    start_time: str | None = None  # canonical "HH:MM" (24h)
    end_time: str | None = None
    subject_initial: str | None = None
    course_code: str | None = None
    course_title: str | None = None
    room: str | None = None
    instructor: str | None = None
    activity_type: ActivityType = ActivityType.UNKNOWN
    batch: str | None = None
    group: str | None = None
    # declared | initialism | near | ambiguous | activity | unknown — how the
    # code was reached through the document's own dictionary (or why not).
    resolution: str | None = None
    spans_slots: int = 1
    source_text: str = ""
    confidence: float = 0.0  # EXTRACTION confidence, not academic correctness
    needs_review: bool = False
    review_reasons: list[ReviewReason] = field(default_factory=list)


@dataclass
class DictionaryEntry:
    initial: str
    course_code: str | None = None
    course_title: str | None = None
    instructor: str | None = None  # name only — never phone/email (PII)


@dataclass
class DocumentMetadata:
    institution: str | None = None
    department: str | None = None
    programme: str | None = None
    semester: int | None = None
    year_level: str | None = None
    division: str | None = None
    class_name: str | None = None
    revision: str | None = None
    academic_year: str | None = None
    effective_date: str | None = None  # ISO "YYYY-MM-DD"
    room: str | None = None
    layout_family: str | None = None


@dataclass
class ParsedDocument:
    document_type: DocumentType = DocumentType.UNKNOWN
    classification_reason: str = ""
    classification_signals: list[str] = field(default_factory=list)
    metadata: DocumentMetadata = field(default_factory=DocumentMetadata)
    timetable: list[TimetableEntry] = field(default_factory=list)
    dictionary: list[DictionaryEntry] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[ParseError] = field(default_factory=list)
    parser_version: str = PARSER_VERSION

    def to_dict(self) -> dict:
        """A JSON-serialisable dict (enums rendered as their string values)."""
        def enc(value):
            if isinstance(value, Enum):
                return value.value
            if isinstance(value, list):
                return [enc(v) for v in value]
            if isinstance(value, dict):
                return {k: enc(v) for k, v in value.items()}
            return value

        return enc(asdict(self))
