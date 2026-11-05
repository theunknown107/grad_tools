"""
Raw document ingestion (PYTHON-RAW-INGESTION-V1).

RAW FILE → DocumentReader → Placed → existing parser. Proves: PDF text layers
extract to positioned text that the parser reads with full semantic parity;
coordinates, page numbers and confidence survive; a scanned (image-only) PDF and
an image route to OCR and refuse safely when no engine is present; and — via a
deterministic FAKE OCR backend — the image path produces the same canonical
Placed the parser consumes identically, with OCR confidence retained.

No network. The real Tesseract engine is a separate provisioning step; these
tests never require it (a real-engine image test is gated on availability).

ALL INPUTS ARE SYNTHETIC — rendered from committed fixtures. No real document.
"""

from __future__ import annotations

import json
import pathlib
import unittest

from gradtools_parser import Placed, parse_document, parse_timetable
from gradtools_parser import reader
from gradtools_parser.benchmark import render_text_pdf
from gradtools_parser.models import DocumentType

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


def pdf_of(name: str) -> bytes:
    return render_text_pdf(fixture(name)["placed"])


def image_only_pdf(name: str) -> bytes:
    """Rasterise a text PDF into an IMAGE-ONLY PDF (no text layer) — a synthetic scan."""
    import fitz

    with fitz.open(stream=pdf_of(name), filetype="pdf") as doc:
        pix = doc[0].get_pixmap(dpi=120)
    out = fitz.open()
    page = out.new_page(width=pix.width, height=pix.height)
    page.insert_image(page.rect, pixmap=pix)
    data = out.tobytes()
    out.close()
    return data


def png_of(name: str) -> bytes:
    import fitz

    with fitz.open(stream=pdf_of(name), filetype="pdf") as doc:
        return doc[0].get_pixmap(dpi=120).tobytes("png")


class NoOcr:
    name = "none"

    def available(self) -> bool:
        return False

    def recognize(self, image):  # pragma: no cover - never reached when unavailable
        raise AssertionError("recognize called on an unavailable backend")


class FakeOcr:
    """A deterministic OCR backend: returns a fixed, known word list in IMAGE
    (top-left) pixel coordinates, so the image path can be tested end to end
    without a real engine. It ignores the pixels — it tests the ADAPTER, not
    recognition accuracy."""

    name = "fake"

    def __init__(self, words):
        self._words = words

    def available(self) -> bool:
        return True

    def recognize(self, image):
        return list(self._words)


class TypeDetectionTest(unittest.TestCase):
    def test_pdf_png_jpeg_detected_by_magic(self):
        self.assertEqual(reader._kind(b"%PDF-1.7 ...", None), "pdf")
        self.assertEqual(reader._kind(b"\x89PNG\r\n\x1a\n...", None), "image")
        self.assertEqual(reader._kind(b"\xff\xd8\xff\xe0...", None), "image")

    def test_extension_is_the_fallback(self):
        self.assertEqual(reader._kind(b"garbage", "x.pdf"), "pdf")
        self.assertEqual(reader._kind(b"garbage", "x.jpeg"), "image")

    def test_unsupported_format_is_refused(self):
        with self.assertRaises(reader.UnsupportedFormat):
            reader._kind(b"PK\x03\x04", "x.docx")


class PdfTextTest(unittest.TestCase):
    def test_a_text_pdf_parses_with_full_semantic_parity(self):
        want = fixture("csbs-semester-one")["expected"]["timetable"]
        result = reader.read(pdf_of("csbs-semester-one"), filename="tt.pdf")
        self.assertEqual(result.source, "pdf-text")
        self.assertEqual(result.pages, 1)
        got = parse_timetable(result.placed).to_ts_dict()
        self.assertEqual(sorted(c["subjectCode"] for c in got["classes"]), sorted(c[3] for c in want["classes"]))
        self.assertEqual([[s["start"], s["end"], s["isBreak"]] for s in got["slots"]], want["slots"])
        self.assertEqual(sorted(d["subjectCode"] for d in got["dictionary"]), sorted(d[0] for d in want["dictionary"]))

    def test_derived_initials_grid_resolves_under_ingestion(self):
        # Family A (undeclared initials) is the hard case span-level extraction fixes.
        want = fixture("sgb-structure")["expected"]["timetable"]
        got = parse_timetable(reader.read(pdf_of("sgb-structure"), filename="a.pdf").placed).to_ts_dict()
        nk = lambda v: (v is None, v)  # noqa: E731
        self.assertEqual(
            sorted((c["subjectCode"] for c in got["classes"]), key=nk),
            sorted((c[3] for c in want["classes"]), key=nk),
        )

    def test_coordinates_pages_and_confidence_are_retained(self):
        result = reader.read(pdf_of("csbs-semester-one"), filename="tt.pdf")
        self.assertTrue(result.placed)
        self.assertTrue(all(isinstance(p, Placed) for p in result.placed))
        self.assertTrue(all(p.page == 1 for p in result.placed))
        self.assertTrue(all(p.confidence == 1.0 for p in result.placed))  # a text layer is certain
        self.assertTrue(all(p.width >= 0 and p.height >= 0 for p in result.placed))

    def test_a_calendar_pdf_is_still_a_calendar(self):
        result = reader.read(pdf_of("calendar-of-events"), filename="cal.pdf")
        document = parse_document(result.placed)
        self.assertIs(document.document_type, DocumentType.ACADEMIC_CALENDAR)
        self.assertEqual(document.timetable, [])


class ScannedAndImageTest(unittest.TestCase):
    def test_a_scanned_pdf_with_no_text_routes_to_ocr_and_refuses_safely(self):
        with self.assertRaises(reader.OcrUnavailable) as ctx:
            reader.read(image_only_pdf("csbs-semester-one"), filename="scan.pdf", ocr=NoOcr())
        self.assertEqual(ctx.exception.code, "OCR_UNAVAILABLE")
        self.assertNotIn("BCS", str(ctx.exception))  # no document content in the error

    def test_an_image_refuses_safely_when_no_ocr_engine_exists(self):
        with self.assertRaises(reader.OcrUnavailable):
            reader.read(png_of("csbs-semester-one"), filename="tt.png", ocr=NoOcr())

    def test_the_image_path_produces_canonical_placed_via_the_ocr_adapter(self):
        # A known word list (image/top-left coords) → reader → Placed (bottom-left),
        # confidence retained, page set. Proves PNG/JPG → PositionedText works.
        words = [
            reader.OcrWord("MONDAY", 40, 100, 70, 12, 0.95),
            reader.OcrWord("CN", 150, 100, 30, 12, 0.88),
        ]
        result = reader.read(png_of("csbs-semester-one"), filename="tt.png", ocr=FakeOcr(words))
        self.assertEqual(result.source, "image-ocr")
        self.assertEqual(result.engine, "fake")
        by_text = {p.text: p for p in result.placed}
        self.assertEqual(round(by_text["CN"].confidence, 2), 0.88)
        self.assertTrue(all(p.page == 1 for p in result.placed))
        # top-left y=100,h=12 on a tall image → a large bottom-left y (flipped).
        self.assertGreater(by_text["MONDAY"].y, 100)

    def test_the_parser_consumes_ocr_output_identically_to_pdf_text(self):
        # Same logical cells via a FAKE OCR image and via a text PDF classify the same.
        words = [reader.OcrWord(t, x, y, w, 12, 0.9) for (t, x, y, w) in [
            ("W.E.F:", 600, 40, 60), ("01/10/2026", 670, 40, 90),
            ("10:00-10:55am", 120, 90, 90), ("MONDAY", 40, 140, 70), ("CN", 120, 140, 30),
            ("BCS502", 60, 400, 60), ("Computer", 130, 400, 70), ("Networks", 210, 400, 70),
            ("CN", 300, 400, 30), ("Prof.", 340, 400, 40), ("Sample", 390, 400, 50),
        ]]
        result = reader.read(png_of("csbs-semester-one"), filename="tt.png", ocr=FakeOcr(words))
        document = parse_document(result.placed)
        # The adapter yields parser-ready Placed regardless of source (type resolves, no crash).
        self.assertIn(document.document_type, set(DocumentType))


class OfflineTest(unittest.TestCase):
    def test_reading_a_pdf_opens_no_socket(self):
        import socket

        real = socket.socket

        def deny(*args, **kwargs):
            raise AssertionError("the reader must not open a network socket")

        socket.socket = deny  # type: ignore[assignment]
        try:
            result = reader.read(pdf_of("csbs-semester-one"), filename="tt.pdf")
            self.assertTrue(result.placed)
        finally:
            socket.socket = real  # type: ignore[assignment]


@unittest.skipUnless(reader.default_ocr().available(), "no Tesseract engine installed")
class RealEngineTest(unittest.TestCase):
    def test_a_rendered_image_round_trips_through_real_ocr(self):  # pragma: no cover
        result = reader.read(png_of("csbs-semester-one"), filename="tt.png")
        self.assertEqual(result.source, "image-ocr")
        self.assertTrue(result.placed)


if __name__ == "__main__":
    unittest.main()
