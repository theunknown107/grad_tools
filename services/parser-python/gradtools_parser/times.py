"""
Time ranges a timetable header prints, read to a 24-hour `HH:MM` clock.

Port of `readSlot` / `toClock` (apps/web/src/domain/timetable-import.ts).
Accepts `10:00-10:55am`, `11:50-12.10pm`, `03:10- 04:05pm`,
`10:00 am to 10:55 am`, `1:05-02:00pm`, punctuated `p.m.`.
"""

from __future__ import annotations

import re

from .layout import collapse

SLOT = re.compile(
    r"(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?\s*(?:[-–—]|to)\s*"
    r"(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?",
    re.IGNORECASE,
)


def to_clock(hour: int, minute: int, meridiem: str | None) -> str | None:
    """Without a meridiem, hours below 8 are the college afternoon."""
    if minute > 59 or hour > 23:
        return None
    h = hour
    marker = None if meridiem is None else meridiem.lower().replace(".", "")
    if marker == "pm" and h < 12:
        h += 12
    elif marker == "am" and h == 12:
        h = 0
    elif marker is None and h < 8:
        h += 12
    if h > 23:
        return None
    return f"{h:02d}:{minute:02d}"


def read_slot(text: str) -> tuple[str, str] | None:
    """The range a header cell describes; an unmarked start takes the reading
    that lands before the end and nearest to it. A backwards range is none."""
    match = SLOT.search(collapse(text))
    if match is None:
        return None
    end = to_clock(int(match.group(4)), int(match.group(5)), match.group(6))
    if end is None:
        return None
    start_hour, start_minute, marked = int(match.group(1)), int(match.group(2)), match.group(3)
    if marked is not None:
        start = to_clock(start_hour, start_minute, marked)
        return (start, end) if start is not None and start < end else None
    candidates = sorted(
        (
            value
            for value in (to_clock(start_hour, start_minute, "am"), to_clock(start_hour, start_minute, "pm"))
            if value is not None and value < end
        ),
        reverse=True,
    )
    return (candidates[0], end) if candidates else None
