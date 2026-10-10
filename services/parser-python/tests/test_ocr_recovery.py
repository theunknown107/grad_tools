"""
The OCR-recovery layer's guarantees, measured on the labelled corpus.

False positives are worse than unresolved values: recovery must add recall
WITHOUT a single wrong code, and everything it recovers must be flagged.
"""

from __future__ import annotations

import unittest

from tests.ocr_corpus import metrics, run

STRICT = run(recovery=False)
RECOVERY = run(recovery=True)


class OcrRecoveryTest(unittest.TestCase):
    def test_recovery_never_produces_a_wrong_code(self):
        wrong = [o.label for o in RECOVERY if o.verdict == "FP"]
        self.assertEqual(wrong, [])

    def test_strict_false_positives_are_only_the_known_typescript_one(self):
        # The TS `near` tier compares against qualifier-expanded candidates
        # (Computer Networks(T/L) -> CNTL), which puts CNLL one letter from
        # BCS502. Strict mode keeps TS parity; recovery removes it (above).
        self.assertEqual([o.label for o in STRICT if o.verdict == "FP"], ["near-miss CNLL (extra letter)"])

    def test_recovery_improves_recall_substantially(self):
        strict, recovered = metrics(STRICT), metrics(RECOVERY)
        self.assertGreaterEqual(recovered["recall"], 0.95)
        self.assertGreater(recovered["recall"], strict["recall"] + 0.2)
        self.assertEqual(recovered["precision"], 1.0)

    def test_everything_recovery_alters_is_flagged_for_review(self):
        for strict, recovered in zip(STRICT, RECOVERY):
            if recovered.verdict == "TP" and strict.verdict != "TP" and recovered.own_evidence_corrupted:
                with self.subTest(case=recovered.label):
                    self.assertTrue(recovered.flagged)

    def test_a_neighbour_freed_from_a_cascade_reads_as_it_was_printed(self):
        freed = [
            o for s, o in zip(STRICT, RECOVERY)
            if o.verdict == "TP" and s.verdict != "TP" and not o.own_evidence_corrupted
        ]
        self.assertTrue(freed)  # FM, once BCS5O2 stops swallowing it
        self.assertTrue(all(o.resolution in ("declared", "initialism") and not o.flagged for o in freed))

    def test_exact_reads_are_untouched_and_unflagged(self):
        for strict, recovered in zip(STRICT, RECOVERY):
            if strict.category == "exact":
                with self.subTest(case=strict.label):
                    self.assertEqual((recovered.predicted, recovered.resolution), (strict.predicted, strict.resolution))
                    self.assertFalse(recovered.flagged)

    def test_ambiguity_near_misses_and_unknowns_stay_unresolved(self):
        for outcome in RECOVERY:
            if outcome.category in ("ambiguous", "near_miss", "unknown"):
                with self.subTest(case=outcome.label):
                    self.assertIsNone(outcome.predicted)

    def test_a_corrupted_course_code_no_longer_cascades(self):
        cascades = [o for o in RECOVERY if o.category == "dictionary" and o.label.startswith("code ")]
        self.assertTrue(cascades)
        self.assertEqual([o.label for o in cascades if o.verdict != "TP"], [])

    def test_known_limitation_a_split_title_word_is_not_guessed(self):
        split = next(o for o in RECOVERY if o.label == "title split   (Net works) :: CN")
        self.assertEqual(split.verdict, "FN")


if __name__ == "__main__":
    unittest.main()
