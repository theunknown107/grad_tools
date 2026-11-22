# 50 — Python parser: raw ingestion and runtime decision

Phase PYTHON-RAW-INGESTION-V1. Two layers must not be confused:

1. **Parser intelligence** — "can Python understand a timetable?" — solved and
   benchmarked (docs/49-era corpus, 71 Python tests, TS parity).
2. **Parser execution** — "where can Python actually run for a GradTools user?"
   — the subject of this document.

## Raw ingestion (done)

```
RAW PDF / PNG / JPG  →  reader.DocumentReader  →  Placed  →  existing parser
```

- **PDF with a text layer** → PyMuPDF, extracted at **span** granularity (one PDF
  text-showing run ≈ a pdf.js text item), confidence 1.0. Span-level is load-
  bearing: word-level splitting defeats the derived-initials resolution on
  departmental grids; spans reproduce the TypeScript parser's results.
- **Scanned PDF / image** → rasterise (PyMuPDF) or load (Pillow), gentle
  preprocessing (grayscale + autocontrast), then a **pluggable OCR backend**.
- The timetable parser never learns the source. `Placed` gained an optional
  `confidence` (default 1.0), so the contract and every fixture are unchanged.

Measured (`python -m gradtools_parser.benchmark --raw`, kept separate from the
structural corpus so 100% parity cannot masquerade as 100% OCR fidelity):
classification / time / day / course_code / title / batch / break = **100%**,
calendar false-positive rate **0%**, merged_span **85.7%** (one *activity* cell's
span width differs by a slot under re-extraction — a benign ingestion nuance, not
a wrong code or a fabricated class).

## Dependency decision

| Need | Choice | Why | Weight |
|---|---|---|---|
| PDF text + positions + raster | **PyMuPDF (fitz)** | one small native lib covers text spans, bboxes and rasterisation; already present | ~10 MB |
| Image load + preprocess | **Pillow (+ numpy)** | stdlib-adjacent, ubiquitous, enough for grayscale/contrast | small |
| OCR | **Tesseract via pytesseract (pluggable, NOT bundled)** | bbox + per-word confidence, offline, permissive licence; the engine is provisioned, never downloaded at parse time | binary ~30–50 MB |

Rejected now, without evidence to justify them: PaddleOCR/EasyOCR (torch/heavy),
cloud OCR (violates offline), OpenCV (Pillow suffices). Heavy imports are **lazy**,
so importing `gradtools_parser` stays pure-stdlib and the core keeps its zero-dep,
no-network guarantee. Optional deps are listed in `requirements-extraction.txt`.

**On this machine the OCR engine is absent** (no `tesseract` binary; Python 3.14
has few OCR wheels). PDF text ingestion is therefore fully exercised; the image /
scanned-PDF path is exercised through a deterministic fake backend (the adapter,
coord-flip and confidence), and refuses safely (`OcrUnavailable`, no document
content in the error) when no engine exists. **The real supplied timetable image
has NOT been OCR'd** — that is blocked on provisioning a Tesseract binary, and is
not claimed.

## Runtime options (where Python can execute)

GradTools is a React/Vite web SPA and a Capacitor Android WebView app
(`app.gradtools`, ~24 MB APK, remote API, no bundled server). Offline document
import on the student's device is a hard requirement.

| | A. Server-side Python | B. Pyodide (WASM) | C. Chaquopy (Android) | D. TS on client, Python server/tooling |
|---|---|---|---|---|
| Web offline | ✗ needs network | ~ (no PyMuPDF/Tesseract WASM) | n/a | ✓ (TS + pdf.js already) |
| Android offline | ✗ needs network | n/a | ~ heavy native per-ABI | ✓ (TS in WebView) |
| Package / APK size | server only | +6–10 MB runtime | +tens of MB per ABI | no change |
| Startup / latency | network round-trip | slow WASM boot | CPython init | unchanged |
| OCR/PDF native stack | ✓ | ✗ (native libs) | ~ (large) | via tesseract.js / pdf.js |
| Python 3.14 wheels | ✓ (control the server) | scarce | scarce | n/a |
| Maintainability | one extra service | fragile | fragile native builds | two parsers, one authority |
| Data privacy | document leaves device | on device | on device | on device |

## Recommendation

- **Web runtime: Option D.** Keep the TypeScript parser as the in-browser
  offline path (pdf.js text layer; existing image handling). Do **not** ship
  Python to the browser — Pyodide cannot run the native PyMuPDF/Tesseract stack
  and costs a large payload for no semantic gain (parity already holds).
- **Android runtime: Option D.** Keep the TypeScript parser in the Capacitor
  WebView. Do **not** embed Python via Chaquopy — unacceptable APK growth and
  native per-ABI build complexity for a parser that already has semantic parity.
- **Python's role:** the reference implementation and parity oracle, the
  corpus/benchmark/OCR harnesses, offline developer tooling (`python -m
  gradtools_parser <file>`), and an **optional server-side** batch/validation
  path (Option A) where the network is acceptable — never the student's offline
  path. If future needs exceed tesseract.js, a server-side Python OCR endpoint is
  the clean, opt-in escalation.

### Why

The offline requirement on student devices is already met by TypeScript. Putting
Python on the client (B/C) imposes large payload/APK and native-build costs,
doesn't run the chosen native OCR/PDF stack cleanly (worse on Python 3.14), and
buys no accuracy because the parsers agree. Python earns its place as the
rigorous reference, the test oracle, and optional server-side heavy lifting.

## What stays in TypeScript (unchanged)

The live client parser and `pdf.js` extraction; `packages/academic-rules` and all
SGPA/CGPA; the OpenRouter/Gemini AI fallback; persistence, the catalogue's
authority, and the UI/Android shell. This phase moved none of them.

## Not done / deferred

- Real-image OCR, blocked on a provisioned Tesseract binary (not claimed).
- `EXAM_TIMETABLE` / `RESULT` families (future, per the corpus report).
- No app integration was built — per Phase 13, the recommendation is Option D
  (keep TS live), so there is no fragile production bridge to build.
