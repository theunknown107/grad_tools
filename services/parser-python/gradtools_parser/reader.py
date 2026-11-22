"""
Raw document ingestion (PYTHON-RAW-INGESTION-V1).

    RAW PDF / PNG / JPG  →  DocumentReader  →  Placed (canonical positioned text)  →  existing parser

This is the ADAPTER that lets the timetable parser consume real files. The
parser itself never learns whether the source was a PDF text layer, OCR, an
image or a synthetic fixture — it only ever sees `Placed`.

DESIGN
  - PDF with a text layer  → direct positioned extraction (PyMuPDF), confidence 1.0.
  - PDF with no text (scanned) → rasterise the page, then the OCR backend.
  - PNG / JPG / JPEG → preprocess, then the OCR backend.

COORDINATES. The parser's `Placed` uses a BOTTOM-LEFT origin (y increases up the
page), matching the TypeScript pdf.js extractor the fixtures were pinned from.
PyMuPDF and image pixels use a TOP-LEFT origin (y increases down), so every y is
flipped here: `y = height - y_bottom_edge`.

OFFLINE & PRIVACY. No function here opens a socket. Heavy libraries (PyMuPDF,
Pillow, an OCR engine) are imported LAZILY, so importing `gradtools_parser`
stays pure-stdlib and the core parser keeps its zero-dependency guarantee. No
raw bytes, extracted text or OCR output is logged or persisted; errors carry a
code and safe metadata only, never document content.

OCR ENGINE. Pluggable (`OcrBackend`). The default is Tesseract via `pytesseract`,
used only when the `tesseract` binary is actually present. When no engine is
available, the image / scanned-PDF paths raise `OcrUnavailable` — they never
guess, and they never silently return nothing.
"""

from __future__ import annotations

import io
import pathlib
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from .layout import Placed

SUPPORTED_EXTENSIONS = (".pdf", ".png", ".jpg", ".jpeg")
# PDF magic is "%PDF"; PNG and JPEG have well-known signatures.
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_JPEG_MAGIC = b"\xff\xd8\xff"


class ReaderError(Exception):
    """A failure that is safe to report. Carries a code, never document content."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class UnsupportedFormat(ReaderError):
    def __init__(self, detail: str) -> None:
        super().__init__("UNSUPPORTED_FORMAT", detail)


class OcrUnavailable(ReaderError):
    def __init__(self) -> None:
        super().__init__(
            "OCR_UNAVAILABLE",
            "This document needs local OCR, but no OCR engine is available. "
            "Install the Tesseract binary to read scanned PDFs and images.",
        )


@dataclass(frozen=True)
class OcrWord:
    """One OCR token in IMAGE pixel coordinates (top-left origin), with confidence."""

    text: str
    x: float
    y: float  # top edge
    width: float
    height: float
    confidence: float


@runtime_checkable
class OcrBackend(Protocol):
    def available(self) -> bool: ...
    def recognize(self, image: object) -> list[OcrWord]: ...


@dataclass(frozen=True)
class ReadResult:
    """Canonical positioned text, plus how it was obtained (for diagnostics)."""

    placed: list[Placed]
    source: str  # "pdf-text" | "pdf-ocr" | "pdf-mixed" | "image-ocr"
    pages: int
    engine: str | None = None
    warnings: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Tesseract OCR backend (used only if the binary is installed)                #
# --------------------------------------------------------------------------- #


class TesseractBackend:
    """pytesseract over the system `tesseract` binary. Offline; no network."""

    name = "tesseract"

    def available(self) -> bool:
        import shutil
        from importlib.util import find_spec

        return shutil.which("tesseract") is not None and find_spec("pytesseract") is not None

    def recognize(self, image: object) -> list[OcrWord]:
        import pytesseract
        from pytesseract import Output

        data = pytesseract.image_to_data(image, output_type=Output.DICT)
        words: list[OcrWord] = []
        for i, text in enumerate(data["text"]):
            token = text.strip()
            if token == "":
                continue
            conf = float(data["conf"][i])
            words.append(
                OcrWord(
                    text=token,
                    x=float(data["left"][i]),
                    y=float(data["top"][i]),
                    width=float(data["width"][i]),
                    height=float(data["height"][i]),
                    confidence=max(conf, 0.0) / 100.0 if conf >= 0 else 0.0,
                )
            )
        return words


def default_ocr() -> OcrBackend:
    return TesseractBackend()


# --------------------------------------------------------------------------- #
# Image preprocessing (Pillow) — only what demonstrably helps OCR             #
# --------------------------------------------------------------------------- #


def _preprocess(image: object) -> object:
    """Grayscale + autocontrast. Deliberately gentle: no aggressive thresholding
    that could destroy a phone photo. Orientation/deskew are deferred until the
    corpus shows they help (no speculative pipeline)."""
    from PIL import ImageOps

    gray = ImageOps.grayscale(image)  # type: ignore[arg-type]
    return ImageOps.autocontrast(gray)


# --------------------------------------------------------------------------- #
# Format dispatch                                                             #
# --------------------------------------------------------------------------- #


def _as_bytes(source: object, filename: str | None) -> tuple[bytes, str | None]:
    if isinstance(source, (bytes, bytearray)):
        return bytes(source), filename
    path = pathlib.Path(source)  # type: ignore[arg-type]
    return path.read_bytes(), path.name


def _kind(data: bytes, filename: str | None) -> str:
    if data[:4] == b"%PDF":
        return "pdf"
    if data[:8] == _PNG_MAGIC or data[:3] == _JPEG_MAGIC:
        return "image"
    ext = pathlib.Path(filename or "").suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext in (".png", ".jpg", ".jpeg"):
        return "image"
    raise UnsupportedFormat(f"Unsupported document format (extension {ext or 'unknown'}).")


def read(source: object, *, filename: str | None = None, ocr: OcrBackend | None = None) -> ReadResult:
    """Reads a raw document into canonical positioned text. `source` is a path,
    `bytes`, or `bytearray`. `ocr` overrides the OCR backend (for tests)."""
    data, name = _as_bytes(source, filename)
    kind = _kind(data, name)
    backend = ocr if ocr is not None else default_ocr()
    if kind == "pdf":
        return _read_pdf(data, backend)
    return _read_image(data, backend)


def _read_pdf(data: bytes, ocr: OcrBackend) -> ReadResult:
    import fitz

    placed: list[Placed] = []
    text_pages = 0
    ocr_pages = 0
    engine: str | None = None
    with fitz.open(stream=data, filetype="pdf") as doc:
        pages = doc.page_count
        for index, page in enumerate(doc, start=1):
            height = page.rect.height
            # SPANS, not words: a span is one PDF text-showing run, the same
            # granularity the TypeScript pdf.js extractor produces and the parser
            # was calibrated on. Word-level splitting defeats the derived-initials
            # resolution on complex departmental grids; spans reproduce it.
            spans = _page_spans(page)
            if spans:
                for text, x0, y1, width, box_height in spans:
                    placed.append(Placed(text, x0, height - y1, width, box_height, index, 1.0))
                text_pages += 1
            else:
                placed.extend(_ocr_pdf_page(page, index, ocr))
                ocr_pages += 1
                engine = getattr(ocr, "name", "ocr")
    source = "pdf-text" if ocr_pages == 0 else "pdf-ocr" if text_pages == 0 else "pdf-mixed"
    return ReadResult(placed, source, pages, engine)


def _page_spans(page: object) -> list[tuple[str, float, float, float, float]]:
    """(text, x0, y1_top, width, height) per text SPAN — one PDF showing run."""
    spans: list[tuple[str, float, float, float, float]] = []
    for block in page.get_text("dict")["blocks"]:  # type: ignore[attr-defined]
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if text == "":
                    continue
                x0, y0, x1, y1 = span["bbox"]
                spans.append((text, x0, y1, x1 - x0, y1 - y0))
    return spans


def _ocr_pdf_page(page: object, index: int, ocr: OcrBackend) -> list[Placed]:
    if not ocr.available():
        raise OcrUnavailable()
    import fitz  # noqa: F401 — the page is a fitz.Page
    from PIL import Image

    pix = page.get_pixmap(dpi=200)  # type: ignore[attr-defined]
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return _ocr_image(image, index, ocr)


def _read_image(data: bytes, ocr: OcrBackend) -> ReadResult:
    if not ocr.available():
        raise OcrUnavailable()
    from PIL import Image

    image = Image.open(io.BytesIO(data))
    image.load()
    placed = _ocr_image(image, 1, ocr)
    return ReadResult(placed, "image-ocr", 1, getattr(ocr, "name", "ocr"))


def _ocr_image(image: object, page: int, ocr: OcrBackend) -> list[Placed]:
    processed = _preprocess(image)
    height = processed.height  # type: ignore[attr-defined]
    placed: list[Placed] = []
    for word in ocr.recognize(processed):
        # pixel top-left → bottom-left baseline
        placed.append(
            Placed(word.text, word.x, height - (word.y + word.height), word.width, word.height, page, word.confidence)
        )
    return placed
