"""
What a timetable says about itself: class, semester, academic year, revision,
effective date and room. Port of `readContext` / `readClassName` /
`readEffectiveFrom` (apps/web/src/domain/timetable-import.ts).

The effective date comes from the printed W.E.F. and from nothing else — never
the upload date.
"""

from __future__ import annotations

import datetime
import re
from dataclasses import dataclass

from .layout import collapse

_WEF = re.compile(
    r"w\.?\s*e\.?\s*f\.?\s*[:\s]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})", re.IGNORECASE
)
_WITH_EFFECT = re.compile(
    r"\bwith\s+effect(?:ive)?\s+from\s*[:\s]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})",
    re.IGNORECASE,
)
_CLASS_LABEL = re.compile(r"\bclass\s*[:\-–]\s*([^\n]{1,60})", re.IGNORECASE)
_CLASS_HEADING = re.compile(r"\b([IVX]{1,4}\s*\(\s*[A-Z]\s*\))\s*[-–—:]?\s*Time\s*-?\s*table\b", re.IGNORECASE)
_CLASS_CUT = re.compile(r"\bTIME\s*-?\s*TABLE\b|\bROOM\b|\bW\.?\s*E\.?\s*F\b|\bACADEMIC\s+YEAR\b", re.IGNORECASE)
_SEMESTER_DIGIT = re.compile(r"\bsemester\s*[:\-–]?\s*([1-8])\b", re.IGNORECASE)
_SEMESTER_ROMAN = re.compile(r"\bsemester\s*[:\-–]?\s*([IVX]{1,4})\b", re.IGNORECASE)
_LEADING_ROMAN = re.compile(r"^([IVX]{1,4})\b", re.IGNORECASE)
_YEAR = re.compile(r"\b(20\d{2})\s*[-–—/]\s*((?:20)?\d{2})\b")
_REVISION = re.compile(r"time\s*-?\s*table\s*\(\s*(R\d)\s*\)", re.IGNORECASE)
_REVISION_LINE = re.compile(r"^.*\btime\s*-?\s*table\b.*?\(\s*(R\d)\s*\).*$", re.IGNORECASE | re.MULTILINE)
_ROOM = re.compile(r"\broom\s*(?:no\.?)?\s*[:\-–]?\s*([A-Z]?\d{2,4}[A-Z]?)\b", re.IGNORECASE)
_DIVISION = re.compile(r"\(\s*([A-Z])\s*\)")

ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8}


@dataclass(frozen=True)
class TimetableContext:
    class_name: str | None = None
    semester: int | None = None
    academic_year: str | None = None
    revision: str | None = None
    effective_from: str | None = None
    room: str | None = None

    @property
    def division(self) -> str | None:
        """`V (B)` → `B`. The parenthesised letter of the VTU class convention."""
        if self.class_name is None:
            return None
        match = _DIVISION.search(self.class_name)
        return None if match is None else match.group(1).upper()


def read_effective_from(text: str) -> str | None:
    match = _WEF.search(text) or _WITH_EFFECT.search(text)
    if match is None:
        return None
    day, month, year = match.group(1), match.group(2), match.group(3)
    try:
        datetime.date(int(year), int(month), int(day))
    except ValueError:
        return None
    return f"{year}-{month.zfill(2)}-{day.zfill(2)}"


def read_class_name(text: str) -> str | None:
    match = _CLASS_LABEL.search(text)
    if match is None:
        heading = _CLASS_HEADING.search(text)
        return None if heading is None else collapse(heading.group(1)).strip()
    cut = _CLASS_CUT.split(match.group(1))[0].strip()
    return cut or None


def read_context(text: str) -> TimetableContext:
    semester_match = _SEMESTER_DIGIT.search(text) or _SEMESTER_ROMAN.search(text)
    raw = semester_match.group(1) if semester_match else ""
    class_name = read_class_name(text)
    from_class = _LEADING_ROMAN.match(class_name or "")

    if re.fullmatch(r"\d", raw):
        semester: int | None = int(raw)
    else:
        semester = ROMAN.get(raw.lower())
        if semester is None and from_class is not None:
            semester = ROMAN.get(from_class.group(1).lower())

    academic_year = None
    year = _YEAR.search(text)
    if year is not None:
        start, tail = year.group(1), year.group(2)
        end = f"20{tail}" if len(tail) == 2 else tail
        if int(end) == int(start) + 1:
            academic_year = f"{start}-{end[2:]}"

    revision = _REVISION.search(text) or _REVISION_LINE.search(text)
    room = _ROOM.search(text)
    return TimetableContext(
        class_name=class_name,
        semester=semester,
        academic_year=academic_year,
        revision=revision.group(1).upper() if revision else None,
        effective_from=read_effective_from(text),
        room=room.group(1) if room else None,
    )
