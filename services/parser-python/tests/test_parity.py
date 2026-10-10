"""
Python ↔ TypeScript SEMANTIC parity.

Each fixture in tests/fixtures was produced by apps/web/test/timetable-python-
parity.test.ts: a synthetic page drawn as a real PDF text layer, read by the
shipped pdf.js extractor, then classified and parsed by the TypeScript parser.
Its `expected` block is that parser's meaning (no pixel geometry). The Python
parser must reproduce it from the same positioned text.

Recovery mode must ALSO reproduce it on every clean fixture: the OCR-recovery
layer may only change outcomes on corrupted input (ocr-variants), never on a
document the strict parser already reads correctly.
"""

from __future__ import annotations

import json
import pathlib
import unittest

from gradtools_parser import Placed, classify, parse_document, parse_timetable
from gradtools_parser.models import DocumentType

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
CORRUPTED = {"ocr-variants"}


def load(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def placed_of(record: dict) -> list[Placed]:
    return [Placed.from_dict(item) for item in record["placed"]]


def project(ts: dict) -> dict:
    """Same projection as the TS side; collections compared as sorted multisets."""
    key = lambda row: json.dumps(row, ensure_ascii=False)  # noqa: E731
    return {
        "context": ts["context"],
        "slots": [[s["start"], s["end"], s["isBreak"]] for s in ts["slots"]],
        "dictionary": sorted(
            ([d["subjectCode"], d["title"], d["initials"], d["faculty"], d["collegeHours"], d["schemeHours"]]
             for d in ts["dictionary"]),
            key=key,
        ),
        "classes": sorted(
            ([c["day"], c["start"], c["end"], c["subjectCode"], c["resolution"], c["initials"], c["batch"],
              c["room"], c["spansSlots"], c["unresolvedReason"], c["sourceText"]] for c in ts["classes"]),
            key=key,
        ),
        "batches": ts["batches"],
        "conflicts": sorted(([k["day"], k["start"], k["batch"], k["initials"]] for k in ts["conflicts"]), key=key),
        "coverage": ts["coverage"],
        "warnings": ts["warnings"],
    }


def normalise_expected(expected: dict) -> dict:
    key = lambda row: json.dumps(row, ensure_ascii=False)  # noqa: E731
    out = dict(expected)
    for field in ("dictionary", "classes", "conflicts"):
        out[field] = sorted(expected[field], key=key)
    return out


class ParityTest(unittest.TestCase):
    maxDiff = None

    def fixtures(self):
        paths = sorted(FIXTURES.glob("*.json"))
        self.assertGreaterEqual(len(paths), 8, "parity fixtures are missing")
        return [(path.stem, load(path)) for path in paths]

    def test_classification_matches_typescript(self):
        for name, record in self.fixtures():
            with self.subTest(fixture=name):
                got = classify(record["lines"])
                want = record["expected"]["classification"]
                self.assertEqual(got.ts_type, want["type"])
                self.assertEqual(got.reason, want["reason"])
                self.assertEqual(got.signals, want["signals"])

    def test_strict_timetable_matches_typescript(self):
        for name, record in self.fixtures():
            want = record["expected"]["timetable"]
            if want is None:
                continue
            with self.subTest(fixture=name):
                got = project(parse_timetable(placed_of(record)).to_ts_dict())
                self.assertEqual(got, normalise_expected(want))

    def test_recovery_changes_nothing_on_clean_documents(self):
        for name, record in self.fixtures():
            want = record["expected"]["timetable"]
            if want is None or name in CORRUPTED:
                continue
            with self.subTest(fixture=name):
                got = project(parse_timetable(placed_of(record), recovery=True).to_ts_dict())
                self.assertEqual(got, normalise_expected(want))

    def test_calendar_never_produces_timetable_entries(self):
        for name, record in self.fixtures():
            if record["expected"]["classification"]["type"] != "academic_calendar":
                continue
            with self.subTest(fixture=name):
                for recovery in (False, True):
                    document = parse_document(placed_of(record), lines=record["lines"], recovery=recovery)
                    self.assertIs(document.document_type, DocumentType.ACADEMIC_CALENDAR)
                    self.assertEqual(document.timetable, [])
                    self.assertEqual(document.metadata.layout_family, "calendar")


if __name__ == "__main__":
    unittest.main()
