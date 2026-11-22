"""
Committed fixtures and source carry no personal data: no email addresses, no
phone numbers, and none of the real institution named on the calibration image.
"""

from __future__ import annotations

import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).parent.parent
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)")
REAL_NAMES = re.compile(r"balekundri|sgbit|belagavi", re.IGNORECASE)


class PiiTest(unittest.TestCase):
    def test_no_personal_data_is_committed(self):
        files = (
            list((ROOT / "tests" / "fixtures").glob("*.json"))
            + list((ROOT / "gradtools_parser").glob("*.py"))
            + [p for p in [ROOT / "corpus-manifest.json"] if p.exists()]
        )
        self.assertTrue(files)
        for path in files:
            text = path.read_text(encoding="utf-8")
            with self.subTest(file=path.name):
                self.assertIsNone(EMAIL.search(text))
                self.assertIsNone(PHONE.search(text))
                self.assertIsNone(REAL_NAMES.search(text))


if __name__ == "__main__":
    unittest.main()
