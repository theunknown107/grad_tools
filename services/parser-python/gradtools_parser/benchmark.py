"""
The parser benchmark (PARSER-CORPUS-TRAINING-V1, Phase 25).

Runs the parser over the SAFE corpus and MEASURES it — nothing here invents a
number. Two parts:

  1. Document/family metrics, from the pinned golden output: classification
     accuracy, per-field timetable accuracy (time, day, course code, title,
     batch, break, merged span), and the academic-calendar false-positive rate
     (a calendar must never yield a timetable entry), reported overall and by
     layout family.

  2. The OCR-resolution survey (tests/ocr_corpus.py): precision, recall,
     false-positive rate and unresolved rate, in strict and recovery mode. The
     academic bar is zero false positives in both modes — a wrong course code
     is worse than "needs review".

Offline and stdlib-only.

    python -m gradtools_parser.benchmark [--json]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

from .layout import Placed
from .timetable import parse_timetable
from .document import parse_document
from .models import DocumentType, PARSER_VERSION
from .corpus import CORPUS_VERSION, FIXTURES_DIR


def _project(ts: dict) -> dict:
    """The semantic projection the parity suite uses (no pixel geometry)."""
    key = lambda row: json.dumps(row, ensure_ascii=False)  # noqa: E731
    return {
        "context": ts["context"],
        "slots": [[s["start"], s["end"], s["isBreak"]] for s in ts["slots"]],
        "dictionary": sorted(
            ([d["subjectCode"], d["title"], d["initials"], d["faculty"], d["collegeHours"], d["schemeHours"]]
             for d in ts["dictionary"]), key=key),
        "classes": sorted(
            ([c["day"], c["start"], c["end"], c["subjectCode"], c["resolution"], c["initials"], c["batch"],
              c["room"], c["spansSlots"], c["unresolvedReason"], c["sourceText"]] for c in ts["classes"]), key=key),
        "batches": ts["batches"],
        "conflicts": sorted(([k["day"], k["start"], k["batch"], k["initials"]] for k in ts["conflicts"]), key=key),
        "coverage": ts["coverage"],
        "warnings": ts["warnings"],
    }


def _norm(expected: dict) -> dict:
    key = lambda row: json.dumps(row, ensure_ascii=False)  # noqa: E731
    out = dict(expected)
    for field in ("dictionary", "classes", "conflicts"):
        out[field] = sorted(expected[field], key=key)
    return out


class Tally:
    """A hit/total counter that renders as an accuracy, 1.0 when nothing applied."""

    def __init__(self) -> None:
        self.hits = 0
        self.total = 0

    def add(self, ok: bool) -> None:
        self.total += 1
        self.hits += 1 if ok else 0

    @property
    def accuracy(self) -> float:
        return self.hits / self.total if self.total else 1.0


def _slot_set(slots: list) -> set:
    return {(s[0], s[1], s[2]) for s in slots}


def _class_tuples(classes: list) -> list:
    # [day, start, end, code, batch, spansSlots] — the semantic identity fields.
    return sorted(([c[0], c[1], c[2], c[3], c[6], c[8]] for c in classes), key=lambda r: json.dumps(r, ensure_ascii=False))


def _positioned(record: dict) -> list[Placed]:
    """The corpus (structural) input: the already-positioned text, verbatim."""
    return [Placed.from_dict(p) for p in record["placed"]]


def run(fixtures_dir: pathlib.Path = FIXTURES_DIR, *, placed_for=_positioned, mode: str = "corpus") -> dict:
    paths = sorted(fixtures_dir.glob("*.json"))
    families: dict[str, dict[str, Tally]] = {}
    overall = {m: Tally() for m in ("classification", "time", "day", "course_code", "title", "batch", "break", "merged_span")}
    calendars = 0
    calendar_false_positives = 0

    def fam(name: str) -> dict[str, Tally]:
        return families.setdefault(name, {m: Tally() for m in overall})

    for path in paths:
        record = json.loads(path.read_text(encoding="utf-8"))
        family = record.get("family", "?")
        expected = record["expected"]
        want_class = expected["classification"]["type"]
        want_tt = expected.get("timetable")

        placed = placed_for(record)
        parsed_doc = parse_document(placed, lines=record["lines"] if mode == "corpus" else None)
        got_class = _TS_TYPE.get(parsed_doc.document_type, "unknown")
        ok_class = got_class == want_class
        overall["classification"].add(ok_class)
        fam(family)["classification"].add(ok_class)

        if want_class == "academic_calendar":
            calendars += 1
            if parsed_doc.timetable:
                calendar_false_positives += 1
            continue
        if want_tt is None:
            continue

        got = _project(parse_timetable(placed).to_ts_dict())
        want = _norm(want_tt)

        # Time (slot intervals) and break rows (isBreak flag) come from the slots.
        got_slots, want_slots = _slot_set(got["slots"]), _slot_set(want["slots"])
        for metric in ("time", "break"):
            ok = got_slots == want_slots
            overall[metric].add(ok)
            fam(family)[metric].add(ok)

        got_days = {c[0] for c in got["classes"]}
        want_days = {c[0] for c in want["classes"]}
        overall["day"].add(got_days == want_days)
        fam(family)["day"].add(got_days == want_days)

        nk = lambda v: (v is None, v)  # noqa: E731 — None-safe sort for unresolved fields
        got_codes = sorted((c[3] for c in got["classes"]), key=nk)
        want_codes = sorted((c[3] for c in want["classes"]), key=nk)
        overall["course_code"].add(got_codes == want_codes)
        fam(family)["course_code"].add(got_codes == want_codes)

        got_titles = sorted((d[1] for d in got["dictionary"]), key=nk)
        want_titles = sorted((d[1] for d in want["dictionary"]), key=nk)
        overall["title"].add(got_titles == want_titles)
        fam(family)["title"].add(got_titles == want_titles)

        got_batches, want_batches = sorted(got["batches"]), sorted(want["batches"])
        overall["batch"].add(got_batches == want_batches)
        fam(family)["batch"].add(got_batches == want_batches)

        ok_merged = _class_tuples(got["classes"]) == _class_tuples(want["classes"])
        overall["merged_span"].add(ok_merged)
        fam(family)["merged_span"].add(ok_merged)

    result = {
        "mode": mode,
        "documentsTested": len(paths),
        "overall": {m: round(t.accuracy, 4) for m, t in overall.items()},
        "byFamily": {
            f: {m: round(t.accuracy, 4) for m, t in metrics.items() if t.total}
            for f, metrics in sorted(families.items())
        },
        "calendars": calendars,
        "calendarFalsePositiveRate": round(calendar_false_positives / calendars, 4) if calendars else 0.0,
    }
    # The OCR resolution survey measures RECOGNITION, not INGESTION, so it belongs
    # to the structural (corpus) run only — never mixed into raw-ingestion numbers.
    if mode == "corpus":
        result["ocr"] = _ocr_survey()
    return result


# --------------------------------------------------------------------------- #
# Raw-ingestion benchmark (Phase 17): file → reader → parser, kept SEPARATE    #
# --------------------------------------------------------------------------- #


def render_text_pdf(runs: list[dict]) -> bytes:
    """A synthetic TEXT-LAYER PDF from a fixture's positioned runs. Round-trips
    through the real reader so raw mode measures PDF ingestion, not pixels. Every
    value is from a committed synthetic fixture — no real document is touched."""
    import fitz

    height = max((r["y"] for r in runs), default=760) + 40
    width = max((r["x"] + len(r["text"]) * 6 for r in runs), default=1000) + 40
    doc = fitz.open()
    page = doc.new_page(width=width, height=height)
    for run in runs:
        text = run["text"]
        if text.strip() == "":
            continue
        page.insert_text((run["x"], height - run["y"]), text, fontsize=9)
    data = doc.tobytes()
    doc.close()
    return data


def run_raw(fixtures_dir: pathlib.Path = FIXTURES_DIR) -> dict:
    """RAW ingestion: render each fixture to a synthetic text PDF, read it back
    through the reader, and measure the same fields — reported on its own."""
    from . import reader

    def placed_for(record: dict) -> list[Placed]:
        return reader.read(render_text_pdf(record["placed"]), filename="synthetic.pdf").placed

    return run(fixtures_dir, placed_for=placed_for, mode="raw-pdf-text")


_TS_TYPE = {
    DocumentType.TIMETABLE: "college_timetable",
    DocumentType.ACADEMIC_CALENDAR: "academic_calendar",
    DocumentType.EXAM_TIMETABLE: "exam_timetable",
    DocumentType.RESULT: "result",
    DocumentType.COURSE_SCHEME: "course_scheme",
    DocumentType.UNKNOWN: "unknown",
}


def _ocr_survey() -> dict:
    """The OCR precision/recall survey from tests/ocr_corpus.py, if reachable."""
    root = str(pathlib.Path(__file__).resolve().parent.parent)
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        from tests import ocr_corpus  # type: ignore
    except Exception:  # pragma: no cover - only when run outside the package root
        return {"available": False}
    out = {"available": True}
    for mode, recovery in (("strict", False), ("recovery", True)):
        m = ocr_corpus.metrics(ocr_corpus.run(recovery))
        out[mode] = {
            "precision": round(m["precision"], 4),
            "recall": round(m["recall"], 4),
            "falsePositiveRate": round(m["false_positive_rate"], 4),
            "unresolvedRate": round(m["unresolved_rate"], 4),
            "falsePositives": m["FP"],
        }
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gradtools_parser.benchmark")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    parser.add_argument(
        "--raw",
        action="store_true",
        help="RAW ingestion (file → reader → parser), kept separate from the structural corpus",
    )
    args = parser.parse_args(argv)

    result = run_raw() if args.raw else run()
    if args.json:
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0

    print(f"GradTools parser benchmark [{result['mode']}] — {PARSER_VERSION} / {CORPUS_VERSION}")
    print(f"documents tested: {result['documentsTested']}\n")
    print("overall:")
    for metric, value in result["overall"].items():
        print(f"  {metric:14} {value * 100:6.2f}%")
    print(f"  {'calendar FP':14} {result['calendarFalsePositiveRate'] * 100:6.2f}%  ({result['calendars']} calendars)")
    print("\nby family:")
    for family, metrics in result["byFamily"].items():
        cells = "  ".join(f"{m}={v * 100:.1f}%" for m, v in metrics.items())
        print(f"  {family:3} {cells}")
    ocr = result.get("ocr")
    if ocr is not None and ocr.get("available"):
        print("\nOCR resolution survey:")
        for mode in ("strict", "recovery"):
            s = ocr[mode]
            print(
                f"  {mode:9} precision={s['precision']:.3f} recall={s['recall']:.3f} "
                f"FPR={s['falsePositiveRate']:.3f} unresolved={s['unresolvedRate']:.3f} FP={s['falsePositives']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
