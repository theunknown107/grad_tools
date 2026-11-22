"""
GradTools offline document parser (Python).

Input:  positioned text (`Placed`: text + box + page) — the same `PlacedLike`
        contract the TypeScript parser reads, produced by the shared extraction
        (pdf.js text layer / OCR words). This package performs no OCR and never
        opens a network connection; it is pure standard library.
Output: classification, plus — for a class timetable — the grid, the
        document-local subject dictionary, context and review reasons.

Boundary: OCR/PDF extraction, persistence, UI, the catalogue's authority,
academic-rules and the AI fallback remain in TypeScript. Until semantic parity
is accepted, the TypeScript parser stays the live path; this package is
exercised by its own tests and the cross-language parity suite.
"""

from .classify import Classification, classify
from .document import lines_of, parse_document
from .layout import Placed
from .timetable import ParsedTimetable, parse_timetable
from .times import read_slot

__all__ = [
    "Classification",
    "ParsedTimetable",
    "Placed",
    "classify",
    "lines_of",
    "parse_document",
    "parse_timetable",
    "read_slot",
]
