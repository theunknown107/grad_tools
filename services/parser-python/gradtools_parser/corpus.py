"""
The corpus manifest (PARSER-CORPUS-TRAINING-V1, Phase 22 / 32).

Describes the SAFE calibration corpus the parser is measured against: one entry
per committed fixture, with its document family, type, structural features, a
content hash, and whether a golden expected output is available. Pure stdlib and
offline — it reads the fixtures the parity suite pins and writes a manifest; it
ingests no external document and makes no network call.

Every fixture is synthetic (drawn as a PDF text layer in the TypeScript parity
test, from real document STRUCTURE with every name, code and number replaced),
so `sourceKind` is always "synthetic" and `privacy` is "safe". The PII guard
(tests/test_pii.py) fails CI if that ever stops being true.

    python -m gradtools_parser.corpus build [--out PATH]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys

from .models import PARSER_VERSION

# Bump when the corpus changes meaning (a fixture added/removed/retruthed),
# independently of PARSER_VERSION — a parser change must not silently move it.
CORPUS_VERSION = "corpus-2026.10-1"

FIXTURES_DIR = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures"
DEFAULT_MANIFEST = pathlib.Path(__file__).resolve().parent.parent / "corpus-manifest.json"

# The classifier's TS type names → the canonical DocumentType taxonomy.
TS_TO_DOCTYPE = {
    "college_timetable": "TIMETABLE",
    "academic_calendar": "ACADEMIC_CALENDAR",
    "exam_timetable": "EXAM_TIMETABLE",
    "result": "RESULT",
    "course_scheme": "COURSE_SCHEME",
    "unknown": "UNKNOWN",
}

# Fixtures whose cells are deliberately OCR-corrupted (the recovery baseline).
_CORRUPTED = {"ocr-variants"}


def _features(record: dict) -> list[str]:
    """Structural features a fixture exercises, read from its pinned expected output."""
    features: list[str] = []
    timetable = (record.get("expected") or {}).get("timetable")
    name = record.get("name", "")
    if timetable is None:
        return features
    dictionary = timetable.get("dictionary") or []
    classes = timetable.get("classes") or []
    slots = timetable.get("slots") or []
    if dictionary:
        features.append("subject_dictionary")
    else:
        features.append("missing_dictionary")
    # class tuple: [day,start,end,code,resolution,initials,batch,room,spansSlots,reason,sourceText]
    if any(len(c) > 6 and c[6] is not None for c in classes):
        features.append("batch_lab")
    if any(len(c) > 8 and isinstance(c[8], int) and c[8] > 1 for c in classes):
        features.append("multi_period")
        features.append("merged_cells")
    if any(len(s) > 2 and s[2] for s in slots):
        features.append("break")
    if timetable.get("conflicts"):
        features.append("conflict")
    if name in _CORRUPTED or "ocr" in name:
        features.append("ocr_recovery")
    return features


def build_items(fixtures_dir: pathlib.Path = FIXTURES_DIR) -> list[dict]:
    items: list[dict] = []
    for path in sorted(fixtures_dir.glob("*.json")):
        raw = path.read_bytes()
        record = json.loads(raw.decode("utf-8"))
        classification = (record.get("expected") or {}).get("classification") or {}
        ts_type = classification.get("type", "unknown")
        timetable = (record.get("expected") or {}).get("timetable")
        items.append(
            {
                "id": record.get("name", path.stem),
                "sourceFamily": record.get("family"),
                "documentType": TS_TO_DOCTYPE.get(ts_type, "UNKNOWN"),
                "sourceKind": "synthetic",
                "privacy": "safe",
                "features": _features(record),
                "expectedAvailable": ts_type == "academic_calendar" or timetable is not None,
                "about": record.get("about", ""),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    return items


def build_manifest(fixtures_dir: pathlib.Path = FIXTURES_DIR) -> dict:
    items = build_items(fixtures_dir)
    return {
        "corpusVersion": CORPUS_VERSION,
        "parserVersion": PARSER_VERSION,
        "generatedFrom": "services/parser-python/tests/fixtures",
        "itemCount": len(items),
        "items": items,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gradtools_parser.corpus")
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="write the corpus manifest")
    build.add_argument("--out", default=str(DEFAULT_MANIFEST))
    build.add_argument("--check", action="store_true", help="fail if the manifest is stale instead of writing")
    args = parser.parse_args(argv)

    manifest = build_manifest()
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    out = pathlib.Path(args.out)
    if args.check:
        current = out.read_text(encoding="utf-8") if out.exists() else ""
        if current != text:
            print("corpus-manifest.json is stale; run `python -m gradtools_parser.corpus build`", file=sys.stderr)
            return 1
        print(f"corpus manifest up to date ({manifest['itemCount']} items)")
        return 0
    out.write_text(text, encoding="utf-8")
    print(f"wrote {out} ({manifest['itemCount']} items, {CORPUS_VERSION})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
