"""
Reading a college class timetable, which is a GRID rather than a list.

Port of `parseTimetable` (apps/web/src/domain/timetable-import.ts). Columns come
from the header's own printed time ranges, rows from the day names, and every
cell is placed by where its box actually is. Nothing about a particular
document is assumed: no subject strings, no college names, no file names.

`recovery=False` (default) is the strict port — semantic parity with the
TypeScript parser is what the parity suite asserts. `recovery=True` adds the
bounded OCR-recovery layer from `ocr_recovery.py`; every recovered value is
flagged for review and never presented as identified.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field, replace

from .context import TimetableContext, read_context
from .dictionary import DictionaryRow, LayoutRow, Resolution, read_dictionary, resolve_grid_subject
from .layout import Placed, collapse, median_height, normalize_ocr_text, rows_of
from .times import read_slot

DAY_NAMES = {
    "monday": "Mon", "mon": "Mon",
    "tuesday": "Tue", "tue": "Tue", "tues": "Tue",
    "wednesday": "Wed", "wed": "Wed",
    "thursday": "Thu", "thu": "Thu", "thur": "Thu", "thurs": "Thu",
    "friday": "Fri", "fri": "Fri",
    "saturday": "Sat", "sat": "Sat",
}
WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

BREAK_CELL = re.compile(r"^(lunch|break|recess|lunch\s*break|interval)$", re.IGNORECASE)
SPLIT_CELL = re.compile(
    r"^([A-Z]{2,6})[\s-]*(E\d|B\d)[\s-]*/[\s-]*([A-Z]{2,6})[\s-]*(E\d|B\d)$", re.IGNORECASE
)
COMPONENT_SUFFIX = re.compile(r"^([A-Z]{2,6})-(T|P|L|TH|PR)$", re.IGNORECASE)
LAB_CELL = re.compile(r"^([A-Z]{2,6})\s*LAB\s*\(([^)]*)\)$", re.IGNORECASE)
PLAIN = re.compile(r"^([A-Z]{2,6})$", re.IGNORECASE)
UPPER_ABBREVIATION = re.compile(r"[A-Z]{2,6}")
WITH_ROOM = re.compile(r"^([A-Z]{2,6})\s+([A-Z]{1,4}-?\d{1,4}[A-Z]?)$", re.IGNORECASE)
TRAILING_ROOM = re.compile(r"^(.*?)\s+([A-Z]{1,4}-?\d{1,4}[A-Z]?)$", re.IGNORECASE)
CLOCK = re.compile(r"(?<![\d.:/])\d{1,2}[:.]\d{2}(?![.:/]\d)")
SEPARATOR_WORD = re.compile(r"^(?:to|till|until|[-–—])$", re.IGNORECASE)
LEADERS = re.compile(r"^[-–—_.·•*=~\s]+|[-–—_.·•*=~\s]+$")
VERTICAL_BREAK = re.compile(r"BREAK|LUNCH|RECESS|INTERVAL")

ACTIVITY_REASON = (
    "Printed as an activity, not a subject in this timetable's subject list. Kept under its printed name."
)
UNKNOWN_CELL_REASON = (
    "This cell is not a subject abbreviation this timetable defines. Check it against the printed timetable."
)


def _letters(text: str) -> str:
    return re.sub(r"[^A-Za-z]", "", text).lower()


def _alnum_count(text: str) -> int:
    return len(re.sub(r"[^A-Za-z0-9]", "", text))


def _day_of(item: Placed) -> str | None:
    return DAY_NAMES.get(_letters(item.text))


@dataclass(frozen=True)
class TimeSlot:
    start: str
    end: str
    left: float
    right: float
    is_break: bool = False
    break_kind: str | None = None  # "LUNCH" | "BREAK" — Python-only detail


@dataclass(frozen=True)
class GridClass:
    day: str
    start: str
    end: str
    subject_code: str | None
    resolution: str
    unresolved_reason: str | None
    initials: str
    batch: str | None
    room: str | None
    spans_slots: int
    source_text: str
    shape: str = "text"  # split | lab | plain | component | with_room | text — Python-only
    ocr_recovered: bool = False  # recovery mode only


@dataclass(frozen=True)
class TimetableConflict:
    day: str
    start: str
    batch: str | None
    initials: list[str]


@dataclass(frozen=True)
class TimetableCoverage:
    cells_found: int = 0
    cells_resolved: int = 0
    slots_found: int = 0
    dictionary_entries: int = 0
    looks_complete: bool = False


@dataclass
class ParsedTimetable:
    context: TimetableContext
    slots: list[TimeSlot] = field(default_factory=list)
    dictionary: list[DictionaryRow] = field(default_factory=list)
    classes: list[GridClass] = field(default_factory=list)
    batches: list[str] = field(default_factory=list)
    conflicts: list[TimetableConflict] = field(default_factory=list)
    coverage: TimetableCoverage = field(default_factory=TimetableCoverage)
    warnings: list[str] = field(default_factory=list)

    def to_ts_dict(self) -> dict:
        """The TypeScript `ParsedTimetable` shape (camelCase), for adapters/parity."""
        c = self.context
        return {
            "context": {
                "className": c.class_name, "semester": c.semester, "academicYear": c.academic_year,
                "revision": c.revision, "effectiveFrom": c.effective_from, "room": c.room,
            },
            "slots": [
                {"start": s.start, "end": s.end, "left": s.left, "right": s.right, "isBreak": s.is_break}
                for s in self.slots
            ],
            "dictionary": [
                {
                    "subjectCode": d.subject_code, "title": d.title, "initials": d.initials,
                    "faculty": d.faculty, "collegeHours": d.college_hours, "schemeHours": d.scheme_hours,
                }
                for d in self.dictionary
            ],
            "classes": [
                {
                    "day": g.day, "start": g.start, "end": g.end, "subjectCode": g.subject_code,
                    "resolution": g.resolution, "unresolvedReason": g.unresolved_reason,
                    "initials": g.initials, "batch": g.batch, "room": g.room,
                    "spansSlots": g.spans_slots, "sourceText": g.source_text,
                }
                for g in self.classes
            ],
            "batches": list(self.batches),
            "conflicts": [
                {"day": k.day, "start": k.start, "batch": k.batch, "initials": list(k.initials)}
                for k in self.conflicts
            ],
            "coverage": {
                "cellsFound": self.coverage.cells_found, "cellsResolved": self.coverage.cells_resolved,
                "slotsFound": self.coverage.slots_found, "dictionaryEntries": self.coverage.dictionary_entries,
                "looksComplete": self.coverage.looks_complete,
            },
            "warnings": list(self.warnings),
        }


def slot_at(slots: list[TimeSlot], left: float, right: float) -> int:
    """The column a box's centre falls inside, else the nearest one."""
    centre = (left + right) / 2
    for index, slot in enumerate(slots):
        if slot.left <= centre <= slot.right:
            return index
    best, distance = -1, math.inf
    for index, slot in enumerate(slots):
        gap = min(abs(centre - slot.left), abs(centre - slot.right))
        if gap < distance:
            distance, best = gap, index
    return best


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def parse_timetable(placed_in: list[Placed], recovery: bool = False) -> ParsedTimetable:
    if recovery:
        from . import ocr_recovery  # only the opt-in recovery layer needs it

        placed_in = [replace(item, text=normalize_ocr_text(item.text)) for item in placed_in]
    placed = list(placed_in)

    if not placed:
        return ParsedTimetable(context=TimetableContext(), warnings=["Nothing could be read from this document."])

    tolerance = median_height(placed) * 0.6
    rows = rows_of(placed, tolerance)
    row_text = [collapse(" ".join(item.text for item in row)).strip() for row in rows]
    joined = "\n".join(row_text)

    context = read_context(joined)
    layout = [LayoutRow(y=row[0].y, runs=[item for item in row if item.text.strip() != ""]) for row in rows]
    dictionary_rows = row_text
    if recovery:
        dictionary_rows, layout = ocr_recovery.repair_dictionary_rows(row_text, layout)
    dictionary = read_dictionary(dictionary_rows, layout)
    if recovery:
        dictionary = ocr_recovery.mark_corrected(dictionary, row_text, dictionary_rows)

    def resolve(initials: str) -> tuple[Resolution, bool]:
        return (
            ocr_recovery.resolve_with_recovery(dictionary, initials)
            if recovery
            else (resolve_grid_subject(dictionary, initials), False)
        )

    # ---- the header block: rows carrying a clock and no day name -------------
    def is_header_row(index: int) -> bool:
        if index >= len(rows):
            return False
        row = rows[index]
        if not CLOCK.search(" ".join(item.text for item in row)):
            return False
        return not any(_day_of(item) is not None for item in row)

    def is_bridge_row(index: int) -> bool:
        if index >= len(rows) or not is_header_row(index + 1):
            return False
        row = rows[index]
        words = [item.text.strip() for item in row if item.text.strip() != ""]
        if not words or any(CLOCK.search(word) for word in words):
            return False
        if any(_day_of(item) is not None for item in row):
            return False
        return any(SEPARATOR_WORD.match(word) for word in words)

    header_index, header_slots = -1, []
    index = 0
    while index < len(rows):
        if not is_header_row(index):
            index += 1
            continue
        last = index
        while last + 1 < len(rows) and (is_header_row(last + 1) or is_bridge_row(last + 1)):
            last += 1
        block = [item for row in rows[index : last + 1] for item in row if item.text.strip() != ""]

        groups: list[list[Placed]] = []
        for item in sorted(block, key=lambda i: i.x):
            for group in groups:
                left = min(member.x for member in group)
                right = max(member.x + member.width for member in group)
                if item.x <= right and item.x + item.width >= left:
                    group.append(item)
                    break
            else:
                groups.append([item])

        found = []
        for group in groups:
            text = " ".join(item.text for item in sorted(group, key=lambda i: (-i.y, i.x)))
            slot = read_slot(text)
            if slot is None:
                continue
            found.append(
                TimeSlot(
                    start=slot[0], end=slot[1],
                    left=min(item.x for item in group),
                    right=max(item.x + item.width for item in group),
                )
            )
        if len(found) > len(header_slots):
            header_slots, header_index = found, last
        index = last + 1

    if len(header_slots) < 2:
        return ParsedTimetable(
            context=context,
            dictionary=dictionary,
            coverage=TimetableCoverage(dictionary_entries=len(dictionary)),
            warnings=["The times along the top of this timetable could not be read."],
        )

    slots = sorted(header_slots, key=lambda s: s.left)
    bounded = [
        replace(
            slot,
            left=slot.left - 40 if position == 0 else (slots[position - 1].right + slot.left) / 2,
            right=slot.right + 40 if position == len(slots) - 1 else (slot.right + slots[position + 1].left) / 2,
        )
        for position, slot in enumerate(slots)
    ]

    break_columns: dict[int, str] = {}
    classes: list[GridClass] = []
    batches: set[str] = set()

    def day_name_in(row: list[Placed]) -> str | None:
        for item in row:
            day = _day_of(item)
            if day is not None:
                return day
        return None

    label_rows = [i for i in range(header_index + 1, len(rows)) if day_name_in(rows[i]) is not None]

    grid_steps = sorted(
        step
        for i in range(header_index + 2, len(rows))
        if (step := rows[i - 1][0].y - rows[i][0].y) > 0
    )
    grid_step = tolerance if not grid_steps else grid_steps[len(grid_steps) // 2]

    def label_y(i: int) -> float:
        return rows[i][0].y

    bands: list[tuple[str, list[Placed]]] = []
    for position, label_row in enumerate(label_rows):
        day = day_name_in(rows[label_row])
        if day is None:
            continue
        y = label_y(label_row)
        previous = label_y(label_rows[position - 1]) if position > 0 else None
        nxt = label_y(label_rows[position + 1]) if position + 1 < len(label_rows) else None
        lone = grid_step * 3
        above = previous - y if previous is not None else (y - nxt if nxt is not None else lone)
        below = y - nxt if nxt is not None else (previous - y if previous is not None else lone)
        top, bottom = y + above / 2, y - below / 2

        items = []
        for i in range(header_index + 1, len(rows)):
            row_y = label_y(i)
            if row_y > top or row_y < bottom:
                continue
            items.extend(item for item in rows[i] if _day_of(item) is None)
        bands.append((day, items))

    for day, band_items in bands:
        by_column: dict[int, list[Placed]] = {}
        for item in band_items:
            if _alnum_count(item.text) < 2:
                continue
            column = slot_at(bounded, item.x, item.x + item.width)
            if column < 0:
                continue
            by_column.setdefault(column, []).append(item)

        def edges(items: list[Placed]) -> tuple[float, float]:
            top = max(item.y for item in items)
            line = [item for item in items if top - item.y <= tolerance]
            return min(item.x for item in line), max(item.x + item.width for item in line)

        cells: list[list] = []
        for column, items in sorted(by_column.items(), key=lambda kv: kv[0]):
            if cells:
                previous = cells[-1]
                prev_right = edges(previous[1])[1]
                reach = slot_at(bounded, prev_right - 1, prev_right)
                own_left = edges(items)[0]
                begins = slot_at(bounded, own_left, own_left)
                if reach >= column or begins <= previous[0]:
                    previous[1].extend(items)
                    continue
            cells.append([column, list(items)])

        for column, items in cells:
            text = collapse(" ".join(item.text for item in sorted(items, key=lambda i: (-i.y, i.x))))
            text = LEADERS.sub("", text).strip()
            if text == "" or _alnum_count(text) < 2:
                continue
            if BREAK_CELL.match(text):
                break_columns.setdefault(column, "LUNCH" if "lunch" in text.lower() else "BREAK")
                continue

            slot = bounded[column]
            right = max(item.x + item.width for item in items)
            last_column = slot_at(bounded, right - 1, right)
            span = max(1, last_column - column + 1)
            end = bounded[min(last_column, len(bounded) - 1)].end

            cell_text = ocr_recovery.repair_cell(text, dictionary) if recovery else text
            recovered_cell = cell_text != text

            def push(initials: str, batch: str | None, room: str | None, shape: str) -> None:
                resolved, recovered = resolve(initials)
                if batch is not None:
                    batches.add(batch.upper())
                classes.append(
                    GridClass(
                        day=day, start=slot.start, end=end,
                        subject_code=resolved.subject_code, resolution=resolved.resolution,
                        unresolved_reason=resolved.reason, initials=initials.upper(),
                        batch=batch.upper() if batch is not None else None, room=room,
                        spans_slots=span, source_text=text, shape=shape,
                        ocr_recovered=recovered or recovered_cell,
                    )
                )

            words = cell_text.split()

            def is_cell_shape(candidate: str) -> bool:
                return candidate == candidate.upper() and bool(
                    SPLIT_CELL.match(candidate)
                    or LAB_CELL.match(candidate)
                    or UPPER_ABBREVIATION.fullmatch(candidate)
                    or COMPONENT_SUFFIX.match(candidate)
                )

            head, printed_room = cell_text, None
            for count in range(len(words), 0, -1):
                candidate = " ".join(words[:count])
                if not is_cell_shape(candidate):
                    continue
                head = candidate
                printed_room = None if count == len(words) else " ".join(words[count:])
                break

            split = SPLIT_CELL.match(head)
            if split:
                rooms = printed_room.split() if printed_room is not None else []
                push(split.group(1), split.group(2), rooms[0] if rooms else None, "split")
                push(split.group(3), split.group(4), rooms[1] if len(rooms) > 1 else (rooms[0] if rooms else None), "split")
                continue

            lab = LAB_CELL.match(head)
            if lab:
                named = [part.strip() for part in re.split(r"[+,/]", lab.group(2) or "") if part.strip()]
                if not named:
                    push(lab.group(1), None, printed_room, "lab")
                for batch in named:
                    push(lab.group(1), batch, printed_room, "lab")
                continue

            plain = PLAIN.match(head)
            if plain:
                push(plain.group(1), None, printed_room, "plain")
                continue

            component = COMPONENT_SUFFIX.match(head)
            if component:
                push(component.group(1), None, printed_room, "component")
                continue

            with_room = WITH_ROOM.match(cell_text)
            if with_room:
                push(with_room.group(1), None, with_room.group(2).upper(), "with_room")
                continue

            trailing = TRAILING_ROOM.match(cell_text)
            label = trailing.group(1) if trailing else cell_text
            spelled, recovered = resolve(label)
            written = bool(re.search(r"[a-z]", label)) or bool(re.search(r"\s", label.strip()))
            if spelled.subject_code is not None:
                resolution, reason = spelled.resolution, spelled.reason
            elif written:
                resolution, reason = "activity", ACTIVITY_REASON
            else:
                resolution, reason = "unknown", UNKNOWN_CELL_REASON
            classes.append(
                GridClass(
                    day=day, start=slot.start, end=end, subject_code=spelled.subject_code,
                    resolution=resolution, unresolved_reason=reason, initials=label[:20], batch=None,
                    room=trailing.group(2).upper() if trailing else None, spans_slots=span,
                    source_text=text, shape="text", ocr_recovered=recovered or recovered_cell,
                )
            )

    # ---- break / lunch set vertically, one letter per printed line ----------
    vertical: dict[int, list[tuple[float, str]]] = {}
    for i in range(header_index + 1, len(rows)):
        for item in rows[i]:
            letters = re.sub(r"[^A-Za-z0-9]", "", item.text)
            if len(letters) != 1:
                continue
            column = slot_at(bounded, item.x, item.x + item.width)
            if column < 0:
                continue
            vertical.setdefault(column, []).append((item.y, letters))
    for column, stack in vertical.items():
        spelled_text = "".join(text for _, text in sorted(stack, key=lambda e: -e[0])).upper()
        hit = VERTICAL_BREAK.search(spelled_text)
        if hit:
            break_columns.setdefault(column, "LUNCH" if "LUNCH" in spelled_text else "BREAK")

    with_breaks = [
        replace(slot, is_break=i in break_columns, break_kind=break_columns.get(i))
        for i, slot in enumerate(bounded)
    ]

    def column_of(start: str) -> int:
        return next((i for i, slot in enumerate(with_breaks) if slot.start == start), -1)

    teaching = [c for c in classes if (col := column_of(c.start)) == -1 or not with_breaks[col].is_break]

    conflicts: list[TimetableConflict] = []
    seen: dict[tuple[str, str, str], list[GridClass]] = {}
    for entry in teaching:
        seen.setdefault((entry.day, entry.start, entry.batch or "*"), []).append(entry)
    for (day, start, batch), bucket in seen.items():
        if len(bucket) >= 2:
            conflicts.append(
                TimetableConflict(day, start, None if batch == "*" else batch, [e.initials for e in bucket])
            )

    warnings: list[str] = []
    if not dictionary:
        warnings.append(
            "The subject table on this timetable could not be read, so the initials in the grid "
            "cannot be matched to subject codes."
        )
    unresolved = [e for e in teaching if e.subject_code is None and e.resolution != "activity"]
    nearly = list(dict.fromkeys(e.initials for e in teaching if e.resolution == "near"))
    if nearly:
        n = len(nearly)
        warnings.append(
            f"{', '.join(nearly)} {_plural(n, 'is', 'are')} not in this timetable's subject list and "
            f"{_plural(n, 'was', 'were')} matched to the closest abbreviation it has. "
            f"Check {_plural(n, 'it', 'them')} before saving."
        )
    if unresolved and dictionary:
        ambiguous = list(dict.fromkeys(e.initials for e in unresolved if e.resolution == "ambiguous"))
        unknown = list(dict.fromkeys(e.initials for e in unresolved if e.resolution != "ambiguous"))
        if unknown:
            warnings.append(
                f"This timetable never says what {', '.join(unknown)} {_plural(len(unknown), 'is', 'are')}. "
                "Those classes are kept, without a subject — check them before saving."
            )
        if ambiguous:
            warnings.append(
                f"{', '.join(ambiguous)} could each be more than one of this timetable's subjects, "
                "so no code was chosen. Check them before saving."
            )
    if context.effective_from is None:
        warnings.append("This timetable does not print an effective date (W.E.F.).")
    if conflicts:
        n = len(conflicts)
        warnings.append(
            f"{n} {_plural(n, 'time has', 'times have')} more than one class. "
            "Check them against the printed timetable."
        )

    resolved_count = sum(1 for e in teaching if e.subject_code is not None or e.resolution == "activity")
    teaching_slots = sum(1 for slot in with_breaks if not slot.is_break)
    days_seen = len({e.day for e in teaching})
    coverage = TimetableCoverage(
        cells_found=len(teaching),
        cells_resolved=resolved_count,
        slots_found=len(with_breaks),
        dictionary_entries=len(dictionary),
        looks_complete=(
            len(teaching) > 0
            and resolved_count >= math.ceil(len(teaching) / 2)
            and teaching_slots >= 4
            and days_seen >= 3
        ),
    )
    if not coverage.looks_complete and teaching:
        warnings.append(
            f"Only part of this timetable could be read — {resolved_count} of {len(teaching)} classes, "
            f"across {teaching_slots} of its time columns. Check it against the printed timetable, "
            "or add the rest by hand."
        )

    return ParsedTimetable(
        context=context,
        slots=with_breaks,
        dictionary=dictionary,
        classes=teaching,
        batches=sorted(batches),
        conflicts=conflicts,
        coverage=coverage,
        warnings=warnings,
    )
