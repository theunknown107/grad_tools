"""
Positioned text, and the rows a page is rebuilt from.

The input contract is the TypeScript `PlacedLike`: one run of text with its box
(`x`, `y` = baseline, `width`, `height`) and the page it came from. The shared
extraction (pdf.js text runs or OCR words) produces it; this package never
reads image bytes, so it has no OCR engine and no way to reach a network.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class Placed:
    text: str
    x: float
    y: float
    width: float
    height: float
    page: int = 1
    # EXTRACTION confidence [0,1]: 1.0 for a PDF text layer, the engine's score
    # for OCR. The strict parser does not read it (so parity is unaffected); it
    # is carried for the raw-ingestion layer and review surfacing. Defaulting to
    # 1.0 keeps every existing caller and fixture unchanged.
    confidence: float = 1.0

    @staticmethod
    def from_dict(raw: dict) -> "Placed":
        return Placed(
            text=str(raw.get("text", "")),
            x=float(raw.get("x", 0)),
            y=float(raw.get("y", 0)),
            width=float(raw.get("width", 0)),
            height=float(raw.get("height", 0)),
            page=int(raw.get("page", 1)),
            confidence=float(raw.get("confidence", 1.0)),
        )


_WS = re.compile(r"\s+")


def collapse(text: str) -> str:
    """`.replace(/\\s+/g, ' ')` — JS and Python `\\s` both cover Unicode spaces."""
    return _WS.sub(" ", text)


def rows_of(items: list[Placed], tolerance: float) -> list[list[Placed]]:
    """Groups placed text into rows by vertical position (anchor = row's first item)."""
    ordered = sorted(items, key=lambda item: (-item.y, item.x))
    rows: list[list[Placed]] = []
    for item in ordered:
        if rows and abs(rows[-1][0].y - item.y) <= tolerance:
            rows[-1].append(item)
        else:
            rows.append([item])
    return [sorted(row, key=lambda item: item.x) for row in rows]


def median_height(items: list[Placed]) -> float:
    heights = sorted(item.height for item in items if item.height > 0)
    return 10.0 if not heights else heights[len(heights) // 2]


def normalize_ocr_text(text: str) -> str:
    """
    Unicode compatibility normalisation for OCR / PDF output: ligatures (`ﬁ`),
    full-width forms and no-break spaces become their plain equivalents. Applied
    only in OCR-recovery mode, so strict mode stays a faithful port of the
    TypeScript parser (which does no such normalisation).
    """
    return unicodedata.normalize("NFKC", text)
