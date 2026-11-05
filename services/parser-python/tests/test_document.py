"""
The document-level output: routing, metadata, entry types, review reasons,
and the duplicate/conflict flag. EVERY VALUE IS SYNTHETIC.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import unittest

from gradtools_parser import Placed, parse_document
from gradtools_parser.models import ActivityType, DocumentType, ParseError, ReviewReason

ROOT = pathlib.Path(__file__).parent.parent
FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def document(name: str, recovery: bool = False):
    record = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    placed = [Placed.from_dict(item) for item in record["placed"]]
    return parse_document(placed, lines=record["lines"], recovery=recovery)


class DocumentTest(unittest.TestCase):
    def test_header_metadata_family_b(self):
        doc = document("csbs-semester-one")
        self.assertIs(doc.document_type, DocumentType.TIMETABLE)
        m = doc.metadata
        self.assertEqual(
            (m.class_name, m.division, m.semester, m.revision, m.academic_year, m.effective_date, m.room),
            ("I (E) CSBS SEMESTER I", "E", 1, "R2", "2026-27", "2026-11-07", "B205"),
        )
        self.assertEqual(m.layout_family, "grid:declared-initials")

    def test_breaks_are_intervals_not_subjects(self):
        doc = document("csbs-semester-one")
        breaks = [e for e in doc.timetable if e.activity_type in (ActivityType.BREAK, ActivityType.LUNCH)]
        self.assertEqual(
            sorted((e.start_time, e.activity_type.value) for e in breaks), [("11:50", "BREAK"), ("14:00", "LUNCH")]
        )
        self.assertTrue(all(e.day is None and e.course_code is None for e in breaks))

    def test_batch_rotations_and_merged_labs(self):
        doc = document("csbs-semester-one")
        tue = [e for e in doc.timetable if e.day == "Tue"]
        split = sorted((e.batch, e.course_code) for e in tue if e.start_time == "10:00")
        self.assertEqual(split, [("E1", "BQHYS102"), ("E2", "BQOPS103")])
        # MAT LAB(E1+E2): ONE lab, one class per named batch, never a subject
        # called "MAT LAB(E1+E2)".
        lab = sorted((e.batch, e.course_code) for e in tue if e.source_text == "MAT LAB(E1+E2)")
        self.assertEqual(lab, [("E1", "BQATS101"), ("E2", "BQATS101")])
        self.assertTrue(all(e.activity_type is ActivityType.LAB for e in tue if e.batch))

    def test_a_merged_cell_is_one_class_across_its_periods(self):
        doc = document("sgb-structure")
        mini = [e for e in doc.timetable if e.activity_type is ActivityType.MINI_PROJECT]
        self.assertEqual({(e.day, e.start_time, e.end_time, e.spans_slots) for e in mini}, {("Mon", "15:10", "17:00", 2)})
        rotation = sorted(
            (e.batch, e.start_time, e.end_time) for e in doc.timetable if e.day == "Wed" and e.batch is not None
        )
        self.assertEqual(rotation, [("B1", "15:10", "17:00"), ("B2", "15:10", "17:00")])

    def test_family_a_activity_types_and_derived_dictionary(self):
        doc = document("sgb-structure")
        types = {e.activity_type for e in doc.timetable}
        self.assertTrue({ActivityType.MINI_PROJECT, ActivityType.VALUE_ADDED, ActivityType.LAB} <= types)
        initials = {d.course_code: d.initial for d in doc.dictionary}
        self.assertEqual((initials["BCS502"], initials["BCS503"]), ("CN", "TOC"))
        self.assertEqual(doc.metadata.layout_family, "grid:derived-initials")

    def test_review_reasons_follow_the_resolution(self):
        doc = document("resolution-tiers")
        reasons = {(e.subject_initial, tuple(r.value for r in e.review_reasons)) for e in doc.timetable if e.day}
        self.assertIn(("CN", ("AMBIGUOUS_SUBJECT",)), reasons)
        self.assertIn(("ESEVM", ("NEAR_MATCH_NEEDS_CHECK",)), reasons)
        self.assertIn(("XYZ", ("UNKNOWN_SUBJECT_INITIAL",)), reasons)
        self.assertIn(("TOC", ()), reasons)

    def test_two_classes_for_one_batch_at_one_time_are_flagged_never_merged(self):
        doc = document("same-batch-conflict")
        flagged = [e for e in doc.timetable if ReviewReason.DUPLICATE_OR_REPEATED_ENTRY in e.review_reasons]
        self.assertEqual(sorted(e.subject_initial for e in flagged), ["PHY", "POP"])
        self.assertTrue(all(e.needs_review for e in flagged))

    def test_a_missing_subject_table_is_reported(self):
        doc = document("no-dictionary")
        self.assertIn(ParseError.SUBJECT_DICTIONARY_NOT_FOUND, doc.errors)
        self.assertIn(ParseError.PARTIAL_PARSE, doc.errors)

    def test_recovered_entries_are_flagged(self):
        doc = document("ocr-variants", recovery=True)
        recovered = [e for e in doc.timetable if ReviewReason.OCR_RECOVERED in e.review_reasons]
        self.assertTrue(recovered)
        self.assertTrue(all(e.needs_review and e.confidence < 1.0 for e in recovered))

    def test_cli_emits_the_typescript_shape(self):
        out = subprocess.run(
            [sys.executable, "-m", "gradtools_parser", "--timetable", str(FIXTURES / "csbs-semester-one.json")],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True,
        )
        parsed = json.loads(out.stdout)
        self.assertEqual(len(parsed["classes"]), 28)
        self.assertEqual(parsed["batches"], ["E1", "E2"])


if __name__ == "__main__":
    unittest.main()
