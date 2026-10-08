"""
The corpus manifest and benchmark (PARSER-CORPUS-TRAINING-V1).

Proves the manifest describes the committed fixtures and cannot silently drift,
that every corpus entry is safe/synthetic, that the benchmark's measured numbers
clear the policy bars (classification exact, calendars never a timetable, OCR
recovery zero false positives), and that the parser never emits a phone or email
from a subject table that contains one.
"""

from __future__ import annotations

import json
import pathlib
import re
import unittest

from gradtools_parser import Placed, parse_timetable
from gradtools_parser.corpus import CORPUS_VERSION, DEFAULT_MANIFEST, build_manifest, build_items
from gradtools_parser.models import PARSER_VERSION
from gradtools_parser import benchmark


class ManifestTest(unittest.TestCase):
    def test_describes_every_fixture_as_safe_and_synthetic(self):
        items = build_items()
        self.assertGreaterEqual(len(items), 8)
        for item in items:
            with self.subTest(item=item["id"]):
                self.assertEqual(item["sourceKind"], "synthetic")
                self.assertEqual(item["privacy"], "safe")
                self.assertIn(item["documentType"], {"TIMETABLE", "ACADEMIC_CALENDAR", "EXAM_TIMETABLE", "RESULT", "COURSE_SCHEME", "UNKNOWN"})
                self.assertEqual(len(item["sha256"]), 64)

    def test_on_disk_manifest_is_not_stale(self):
        expected = json.dumps(build_manifest(), ensure_ascii=False, indent=2) + "\n"
        self.assertTrue(pathlib.Path(DEFAULT_MANIFEST).exists(), "run `python -m gradtools_parser.corpus build`")
        self.assertEqual(
            pathlib.Path(DEFAULT_MANIFEST).read_text(encoding="utf-8"), expected,
            "corpus-manifest.json is stale; run `python -m gradtools_parser.corpus build`",
        )

    def test_corpus_version_is_tracked_separately(self):
        self.assertTrue(CORPUS_VERSION)
        self.assertNotEqual(CORPUS_VERSION, PARSER_VERSION)

    def test_features_are_discovered_from_structure(self):
        by_id = {item["id"]: item for item in build_items()}
        self.assertIn("subject_dictionary", by_id["csbs-semester-one"]["features"])
        self.assertIn("batch_lab", by_id["csbs-semester-one"]["features"])
        self.assertIn("break", by_id["csbs-semester-one"]["features"])
        self.assertIn("missing_dictionary", by_id["no-dictionary"]["features"])
        self.assertIn("conflict", by_id["same-batch-conflict"]["features"])


class BenchmarkTest(unittest.TestCase):
    result = benchmark.run()

    def test_classification_is_exact(self):
        self.assertEqual(self.result["overall"]["classification"], 1.0)

    def test_a_calendar_never_becomes_a_timetable(self):
        self.assertEqual(self.result["calendarFalsePositiveRate"], 0.0)

    def test_timetable_fields_are_measured_and_pass_parity(self):
        for metric in ("time", "day", "course_code", "title", "batch", "break", "merged_span"):
            self.assertEqual(self.result["overall"][metric], 1.0, metric)

    def test_ocr_recovery_has_zero_false_positives(self):
        ocr = self.result["ocr"]
        self.assertTrue(ocr["available"])
        self.assertEqual(ocr["recovery"]["falsePositives"], 0)
        self.assertEqual(ocr["recovery"]["precision"], 1.0)
        # Strict keeps the single known TS-parity near-miss; recovery removes it.
        self.assertLessEqual(ocr["strict"]["falsePositives"], 1)
        self.assertGreater(ocr["recovery"]["recall"], ocr["strict"]["recall"])


class RawBenchmarkTest(unittest.TestCase):
    """Raw ingestion (file → reader → parser) is measured SEPARATELY from the
    structural corpus, so 100% parity cannot masquerade as 100% OCR fidelity."""

    result = benchmark.run_raw()

    def test_mode_is_labelled_and_kept_separate(self):
        self.assertEqual(self.result["mode"], "raw-pdf-text")
        self.assertNotIn("ocr", self.result)  # the recognition survey is a corpus-mode concern

    def test_pdf_ingestion_reproduces_the_semantics(self):
        o = self.result["overall"]
        for metric in ("classification", "time", "day", "course_code", "title", "batch", "break"):
            self.assertEqual(o[metric], 1.0, metric)
        self.assertEqual(self.result["calendarFalsePositiveRate"], 0.0)
        # One activity cell's merged span differs by a slot under re-extraction;
        # measured, documented, not hidden behind the structural 100%.
        self.assertGreaterEqual(o["merged_span"], 0.85)


class PiiDropTest(unittest.TestCase):
    """The real calibration document carried a CONTACT NO column; the parser
    must never surface a phone number or email as faculty, title or code."""

    def _parse_with(self, legend_row: str):
        header = ["10:00-10:55am", "10:55-11:50am", "11:50-12.10pm", "12.10-1:05pm",
                  "1:05-02:00pm", "2:00-03:10pm", "03:10-04:05pm", "04:05-05:00pm"]
        page = [Placed("W.E.F: 01/10/2026", 600, 760, 150, 10, 1)]
        page += [Placed(h, 120 + i * 100, 700, 80, 10, 1) for i, h in enumerate(header)]
        page += [Placed("MONDAY", 40, 660, 70, 10, 1), Placed("CN", 120, 660, 80, 10, 1)]
        page.append(Placed(legend_row, 60, 300, 700, 10, 1))
        return parse_timetable(page)

    def test_a_phone_in_the_subject_table_is_never_emitted(self):
        # A synthetic phone-shaped token (NOT a real number) in a subject row.
        parsed = self._parse_with("BCS502 Computer Networks CN Prof. B Sample 9000000000 3+0+2 3+0+2")
        blob = json.dumps([[d.subject_code, d.title, d.initials, d.faculty] for d in parsed.dictionary])
        self.assertIsNone(re.search(r"(?<!\d)[6-9]\d{9}(?!\d)", blob), blob)

    def test_an_email_in_the_subject_table_is_never_emitted(self):
        parsed = self._parse_with("BCS502 Computer Networks CN Prof. B Sample bsample@example.edu 3+0+2 3+0+2")
        blob = json.dumps([[d.subject_code, d.title, d.initials, d.faculty] for d in parsed.dictionary])
        self.assertIsNone(re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", blob), blob)


if __name__ == "__main__":
    unittest.main()
