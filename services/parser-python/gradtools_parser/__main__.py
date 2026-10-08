"""
CLI: a document in, structured JSON out. Offline by construction.

    python -m gradtools_parser [--timetable] [--recovery] [--debug-layout] [FILE]

FILE may be:
  - a RAW document: .pdf / .png / .jpg / .jpeg — decoded and OCR'd locally
    through the reader (PyMuPDF text layer, or a local OCR engine for scans);
  - positioned-text JSON (a list of placed runs, or `{placed, lines}`) — or
    stdin when no FILE is given.

`--timetable` emits the TypeScript `ParsedTimetable` shape (for parity);
`--debug-layout` prints SAFE layout diagnostics only (counts, source, pages — no
document text), then the parsed JSON. No raw OCR is printed by default.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

from .document import parse_document
from .layout import Placed
from .timetable import parse_timetable

_RAW_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gradtools_parser")
    parser.add_argument("file", nargs="?")
    parser.add_argument("--timetable", action="store_true", help="emit the TS ParsedTimetable shape")
    parser.add_argument("--recovery", action="store_true", help="enable the flagged OCR-recovery layer")
    parser.add_argument("--debug-layout", action="store_true", help="print safe layout counts (no content)")
    args = parser.parse_args(argv)

    lines: list[str] | None = None
    if args.file is not None and pathlib.Path(args.file).suffix.lower() in _RAW_EXTENSIONS:
        from .reader import ReaderError, read

        try:
            result = read(args.file)
        except ReaderError as error:
            json.dump({"error": {"code": error.code, "message": str(error)}}, sys.stdout)
            sys.stdout.write("\n")
            return 2
        placed = result.placed
        if args.debug_layout:
            # Safe diagnostics only: shapes and counts, never document content.
            diag = {
                "source": result.source,
                "pages": result.pages,
                "engine": result.engine,
                "placedCount": len(placed),
                "pagesSeen": sorted({p.page for p in placed}),
            }
            print(json.dumps({"debugLayout": diag}), file=sys.stderr)
    else:
        raw = json.load(open(args.file, encoding="utf-8") if args.file else sys.stdin)
        placed_raw, lines = (raw, None) if isinstance(raw, list) else (raw.get("placed", []), raw.get("lines"))
        placed = [Placed.from_dict(item) for item in placed_raw]

    if args.timetable:
        out = parse_timetable(placed, recovery=args.recovery).to_ts_dict()
    else:
        out = parse_document(placed, lines=lines, recovery=args.recovery).to_dict()
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
