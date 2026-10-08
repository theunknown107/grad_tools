"""
Unit cases for the strict port, mirroring apps/web/test/timetable-import.test.ts
and document-type.test.ts. EVERY VALUE IS SYNTHETIC.
"""

from __future__ import annotations

import unittest

from gradtools_parser import classify, read_slot
from gradtools_parser.context import read_class_name, read_context, read_effective_from
from gradtools_parser.dictionary import DictionaryRow, initialisms_for, read_dictionary, resolve_grid_subject
from gradtools_parser.models import DocumentType


def row(code: str, title: str, initials: str | None = None) -> DictionaryRow:
    return DictionaryRow(code, title, initials, None, None, None)


class SlotTest(unittest.TestCase):
    def test_the_shapes_a_real_header_prints(self):
        cases = {
            "10:00-10:55am": ("10:00", "10:55"),
            "11:50-12.10pm": ("11:50", "12:10"),
            "03:10- 04:05pm": ("15:10", "16:05"),
            "10:00 am to 10:55 am": ("10:00", "10:55"),
            "12.10–1:05 pm": ("12:10", "13:05"),
            "01:05–02:00pm": ("13:05", "14:00"),
            "3:10 p.m. to 4:05 p.m.": ("15:10", "16:05"),
        }
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(read_slot(text), want)

    def test_the_end_tells_the_start_which_half_of_the_day(self):
        self.assertEqual(read_slot("1:05-02:00pm"), ("13:05", "14:00"))
        self.assertEqual(read_slot("12.10-1:05pm"), ("12:10", "13:05"))

    def test_refuses_what_is_not_a_range(self):
        for text in ("MONDAY", "10:00", "11:00-10:00am"):
            with self.subTest(text=text):
                self.assertIsNone(read_slot(text))


class InitialismTest(unittest.TestCase):
    def test_closed_candidate_sets(self):
        self.assertIn("CN", initialisms_for("Computer Networks(T/L)"))
        self.assertEqual(set(initialisms_for("Theory of Computation")), {"TC", "TOC"})
        self.assertIn("RMIPR", initialisms_for("Research Methodology and IPR"))
        self.assertIn("ESEWM", initialisms_for("Environmental Studies and E-waste Management"))
        self.assertIn("MRMM", initialisms_for("Marketing Research & Marketing Management"))


class ResolutionOrderTest(unittest.TestCase):
    def test_a_spelled_out_title_is_a_declaration(self):
        got = resolve_grid_subject([row("BCB586", "Mini project")], "Mini project")
        self.assertEqual((got.subject_code, got.resolution), ("BCB586", "declared"))

    def test_the_declared_column_wins_before_any_initialism(self):
        dictionary = [row("BQATS101", "Mathematics-I for CSE Stream", "MAT"), row("BXX999", "Materials And Technology")]
        got = resolve_grid_subject(dictionary, "MAT")
        self.assertEqual((got.subject_code, got.resolution), ("BQATS101", "declared"))

    def test_two_subjects_with_one_abbreviation_is_ambiguous_and_says_which(self):
        got = resolve_grid_subject([row("BCS502", "Computer Networks"), row("BCS599", "Cloud Native")], "CN")
        self.assertIsNone(got.subject_code)
        self.assertEqual(got.resolution, "ambiguous")
        self.assertIn("BCS502 or BCS599", got.reason)

    def test_one_letter_off_is_near_and_carries_a_reason(self):
        got = resolve_grid_subject([row("BESK508", "Environmental Studies and E-waste Management")], "ESEVM")
        self.assertEqual((got.subject_code, got.resolution), ("BESK508", "near"))
        self.assertIn('"ESEWM"', got.reason)

    def test_short_abbreviations_are_never_near(self):
        got = resolve_grid_subject([row("BCS502", "Computer Networks")], "CM")
        self.assertEqual((got.subject_code, got.resolution), (None, "unknown"))


class DictionaryTest(unittest.TestCase):
    def test_a_wrapped_title_is_rejoined_around_the_faculty(self):
        entries = read_dictionary(
            ["BCB515A Marketing Research & Marketing", "Prof. E. Invented 3+0+0 3+0+0", "Management"]
        )
        self.assertEqual(entries[0].title, "Marketing Research & Marketing Management")
        self.assertEqual((entries[0].college_hours, entries[0].scheme_hours), ("3+0+0", "3+0+0"))

    def test_an_unfilled_initials_column_leaves_titles_whole(self):
        # IPR looks like an initials token, but the table as a whole does not
        # fill that column — so it is part of the title (a column is filled
        # throughout or not at all).
        entries = read_dictionary([
            "BCB501 Fundamentals of Management Prof. A. Example 3+0+0 3+0+0",
            "BCS503 Theory of Computation Dr. C. Placeholder 3+2+0 3+2+0",
            "BRMK557 Research Methodology and IPR Prof. F. Madeup 2+0+0 2+0+0",
        ])
        self.assertEqual((entries[2].title, entries[2].initials), ("Research Methodology and IPR", None))

    def test_a_one_row_table_with_a_caps_word_reads_it_as_declared(self):
        # The same rule, honestly applied: one row of one is a filled column.
        entries = read_dictionary(["BRMK557 Research Methodology and IPR Prof. F. Madeup 2+0+0 2+0+0"])
        self.assertEqual((entries[0].title, entries[0].initials), ("Research Methodology and", "IPR"))

    def test_a_contact_number_is_not_part_of_a_title(self):
        entries = read_dictionary(["BCS503 Theory of Computation 9000000000 Dr. C. Placeholder 3+2+0 3+2+0"])
        self.assertEqual(entries[0].title, "Theory of Computation")


class ContextTest(unittest.TestCase):
    def test_effective_date_formats(self):
        self.assertEqual(read_effective_from("W.E.F: 07/11/2026"), "2026-11-07")
        self.assertEqual(read_effective_from("With effective from: 12.09.2026"), "2026-09-12")
        self.assertIsNone(read_effective_from("W.E.F: 31/02/2026"))

    def test_class_name_stops_at_the_revision_label(self):
        self.assertEqual(read_class_name("CLASS: I (E) CSBS SEMESTER I TIME-TABLE (R2)"), "I (E) CSBS SEMESTER I")

    def test_roman_heading_gives_class_semester_and_division(self):
        context = read_context("V (B) - Timetable for the Academic year 2026-27 (R0)")
        self.assertEqual((context.class_name, context.semester, context.division), ("V (B)", 5, "B"))
        self.assertEqual((context.academic_year, context.revision), ("2026-27", "R0"))


class ClassificationTest(unittest.TestCase):
    def test_a_calendar_printing_weekday_names_is_still_a_calendar(self):
        got = classify([
            "CALENDAR OF EVENTS - ODD SEMESTER 2026-27",
            "Week No. Month Monday Tuesday Wednesday Thursday Friday Saturday Working Days Events",
            "1 Sep Commencement of Semester",
            "16 Dec Last Working Day",
        ])
        self.assertIs(got.document_type, DocumentType.ACADEMIC_CALENDAR)

    def test_an_exam_schedule_outranks_the_timetable_reading(self):
        got = classify([
            "Draft Time Table for B.E. Examinations", "Date, Day Monday Tuesday",
            "10:00-1:00 pm", "Registrar (Evaluation)",
        ])
        self.assertIs(got.document_type, DocumentType.EXAM_TIMETABLE)

    def test_a_question_paper_is_refused(self):
        got = classify(["USN", "Answer any FIVE full questions", "Module - 1", "Max. Marks: 100"])
        self.assertIs(got.document_type, DocumentType.UNKNOWN)
        self.assertIn("question paper", got.reason)

    def test_one_signal_is_never_enough(self):
        self.assertIs(classify(["Monday Tuesday"]).document_type, DocumentType.UNKNOWN)
        self.assertIs(classify([]).document_type, DocumentType.UNKNOWN)


if __name__ == "__main__":
    unittest.main()
