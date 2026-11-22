"""
The OCR-ambiguity benchmark: labelled cases, measured in strict and recovery mode.

    python -m tests.ocr_corpus        (from services/parser-python) prints the table

Every case is a synthetic page (one Monday row, a subject table) whose TRUE
subject code is known. A case's truth is None when the document genuinely does
not identify the subject — then ANY code is a false positive. For academic data
a wrong code is worse than none, so the acceptance bar is: zero false
positives, in both modes, always.

Categories:
  exact        — printed correctly; must resolve, unflagged.
  recoverable  — a realistic OCR corruption of a defined abbreviation.
  ambiguous    — the document itself does not say which subject; must stay unresolved.
  near_miss    — dangerous neighbours (CN/CNL, TOC/TCO, MAT/MATH, short wrong letters,
                 a cell one transposition from TWO subjects); must not cross.
  unknown      — not defined anywhere; must stay unresolved.
  dictionary   — corruption in the SUBJECT TABLE; every subject on the row is scored,
                 so a cascade into a neighbouring subject counts against it.
EVERY SUBJECT AND NAME IS SYNTHETIC.
"""

from __future__ import annotations

from dataclasses import dataclass

from gradtools_parser import Placed, parse_timetable

COLUMNS = [120, 220, 320, 420, 520, 620, 720, 820]
HEADER = [
    "10:00-10:55am", "10:55-11:50am", "11:50-12.10pm", "12.10-1:05pm",
    "1:05-02:00pm", "2:00-03:10pm", "03:10-04:05pm", "04:05-05:00pm",
]

BASE = [
    ("BCB501", "BCB501 Fundamentals of Management Prof. A Example 3+0+0 3+0+0"),
    ("BCS502", "BCS502 Computer Networks(T/L) Prof. B Sample 3+0+2 3+0+2"),
    ("BCSL502", "BCSL502-Computer Networks Lab Prof. B Sample 0+0+2 0+0+2"),
    ("BCS503", "BCS503 Theory of Computation Dr. C Placeholder 3+2+0 3+2+0"),
    ("BRMK557", "BRMK557 Research Methodology and IPR Prof. F Madeup 2+0+0 2+0+0"),
    ("BCSL504", "BCSL504-Computational Statistics Lab Prof. D Fictional 0+0+2 0+0+2"),
    ("BESK508", "BESK508 Environmental Studies and E-waste Management Prof. G Unreal 1+0+0 1+0+0"),
    ("BCB515A", "BCB515A Marketing Research & Marketing Management Prof. E Invented 3+0+0 3+0+0"),
]
CLOUD = ("BCS599", "BCS599 Cloud Native Prof. K Other 3+0+0 3+0+0")
TWINS = [
    ("BXA101", "BXA101 Applied Biology Chemistry Design Prof. L One 3+0+0 3+0+0"),
    ("BXB102", "BXB102 Basic Applied Design Concepts Prof. M Two 3+0+0 3+0+0"),
]


@dataclass(frozen=True)
class Case:
    label: str
    category: str
    cell: str | list[str]
    truth: str | None
    dictionary: tuple = tuple(BASE)


GRID_CASES = [
    # exact
    *[Case(f"exact {c}", "exact", c, t) for c, t in [
        ("FM", "BCB501"), ("CN", "BCS502"), ("CNL", "BCSL502"), ("TOC", "BCS503"), ("RMIPR", "BRMK557"),
        ("CSL", "BCSL504"), ("MRMM", "BCB515A"), ("Toc", "BCS503"), ("TOC.", "BCS503"), ("CN.", "BCS502"),
    ]],
    # recoverable OCR corruptions
    *[Case(f"ocr {c!s}", "recoverable", c, t) for c, t in [
        ("ESEVM", "BESK508"),   # one letter off (strict `near` already)
        ("RMPIR", "BRMK557"),   # adjacent transposition — printed on the real Sem-5 document
        ("RMIRP", "BRMK557"),   # transposition at the end
        ("RMP1R", "BRMK557"),   # 1 for I, then a transposition
        ("RMPlR", "BRMK557"),   # lowercase l for I, then a transposition
        ("T0C", "BCS503"),      # zero for O
        ("CN,", "BCS502"),      # trailing comma
        ("CN/", "BCS502"),      # trailing slash
        ("C N", "BCS502"),      # letters spaced apart (strict reads an "activity")
        ("CSLLAB", "BCSL504"),  # LAB glued to a lab subject's abbreviation
        ("MRMN", "BCB515A"),    # one letter off, four letters
    ]],
    # the document itself does not say
    Case("ambiguous CN (two CN subjects)", "ambiguous", "CN", None, tuple(BASE) + (CLOUD,)),
    Case("ambiguous CN, (two CN subjects)", "ambiguous", "CN,", None, tuple(BASE) + (CLOUD,)),
    # dangerous neighbours — must never cross
    Case("near-miss CM (2 letters)", "near_miss", "CM", None),
    Case("near-miss CNI (extra letter)", "near_miss", "CNI", None),
    Case("near-miss TCO (3-letter swap)", "near_miss", "TCO", None),
    Case("near-miss MATH (absent)", "near_miss", "MATH", None),
    Case("near-miss MATLAB (glued, not a lab)", "near_miss", "MATLAB", None),
    Case("near-miss CNLL (extra letter)", "near_miss", "CNLL", None),
    Case("near-miss ABDC (swap from TWO)", "near_miss", "ABDC", None, tuple(BASE) + tuple(TWINS)),
    Case("near-miss CN0 (trailing digit)", "near_miss", "CN0", None),
    # undefined
    Case("unknown XYZ", "unknown", "XYZ", None),
    Case("unknown DBMS", "unknown", "DBMS", None),
    Case("unknown OOPS", "unknown", "OOPS", None),
]

MONDAY = ["FM", "CN", None, "TOC", "RMIPR", None, "CSL", "ESEWM"]
MONDAY_TRUTH = {"FM": "BCB501", "CN": "BCS502", "TOC": "BCS503", "RMIPR": "BRMK557", "CSL": "BCSL504", "ESEWM": "BESK508"}


def _corrupt(code: str, row: str) -> tuple[tuple, str]:
    """A subject table with one row corrupted, and the code whose row it was."""
    return tuple((c, row if c == code else r) for c, r in BASE), code


DICTIONARY_CASES = [
    ("clean subject table", (tuple(BASE), None)),
    ("code O for 0  (BCS5O2)", _corrupt("BCS502", "BCS5O2 Computer Networks(T/L) Prof. B Sample 3+0+2 3+0+2")),
    ("code hyphen   (BCS-502)", _corrupt("BCS502", "BCS-502 Computer Networks(T/L) Prof. B Sample 3+0+2 3+0+2")),
    ("code space    (BCS 502)", _corrupt("BCS502", "BCS 502 Computer Networks(T/L) Prof. B Sample 3+0+2 3+0+2")),
    ("code S for 5  (BCSSO2)", _corrupt("BCS502", "BCSSO2 Computer Networks(T/L) Prof. B Sample 3+0+2 3+0+2")),
    ("code O for 0  (BCB5O1)", _corrupt("BCB501", "BCB5O1 Fundamentals of Management Prof. A Example 3+0+0 3+0+0")),
    ("honorific     (Pr0f.)", _corrupt("BCS503", "BCS503 Theory of Computation Pr0f. C Placeholder 3+2+0 3+2+0")),
    ("honorific     (Dr,)", _corrupt("BCS503", "BCS503 Theory of Computation Dr, C Placeholder 3+2+0 3+2+0")),
    ("title 0       (Netw0rks)", _corrupt("BCS502", "BCS502 Computer Netw0rks(T/L) Prof. B Sample 3+0+2 3+0+2")),
    ("title split   (Net works)", _corrupt("BCS502", "BCS502 Computer Net works(T/L) Prof. B Sample 3+0+2 3+0+2")),
]


def page(dictionary: tuple, cells: list) -> list[Placed]:
    def at(text: str, x: float, y: float, width: float = 80) -> Placed:
        return Placed(text, x, y, width, 10, 1)

    out = [at("W.E.F: 01/10/2026", 600, 760, 150)]
    out += [at(h, COLUMNS[i], 700) for i, h in enumerate(HEADER)]
    out.append(at("MONDAY", 40, 660, 70))
    for i, cell in enumerate(cells):
        if cell is None:
            continue
        if isinstance(cell, list):
            for j, part in enumerate(cell):
                out.append(at(part, COLUMNS[i] + j * 14, 660, 10))
        else:
            out.append(at(cell, COLUMNS[i], 660))
    out += [at(row, 60, 300 - k * 20, 700) for k, (_, row) in enumerate(dictionary)]
    return out


@dataclass(frozen=True)
class Outcome:
    label: str
    category: str
    truth: str | None
    predicted: str | None
    resolution: str | None
    flagged: bool
    # Whether THIS subject's own printed evidence was corrupted. A neighbour
    # restored only because a cascade stopped was never altered, so it is
    # correctly not flagged.
    own_evidence_corrupted: bool = True

    @property
    def verdict(self) -> str:
        if self.predicted is None:
            return "TN" if self.truth is None else "FN"
        return "TP" if self.predicted == self.truth else "FP"


def _flagged(cls) -> bool:
    return cls.resolution in ("near", "ambiguous", "unknown") or cls.ocr_recovered


def run(recovery: bool) -> list[Outcome]:
    outcomes = []
    for case in GRID_CASES:
        parsed = parse_timetable(page(case.dictionary, [case.cell]), recovery=recovery)
        cell = next((c for c in parsed.classes if c.start == "10:00"), None)
        outcomes.append(
            Outcome(case.label, case.category, case.truth,
                    None if cell is None else cell.subject_code,
                    None if cell is None else cell.resolution,
                    False if cell is None else _flagged(cell))
        )
    for label, (dictionary, corrupted) in DICTIONARY_CASES:
        parsed = parse_timetable(page(dictionary, MONDAY), recovery=recovery)
        by_initials = {c.initials: c for c in parsed.classes}
        for initials, truth in MONDAY_TRUTH.items():
            cell = by_initials.get(initials)
            outcomes.append(
                Outcome(f"{label} :: {initials}", "dictionary", truth,
                        None if cell is None else cell.subject_code,
                        None if cell is None else cell.resolution,
                        False if cell is None else _flagged(cell),
                        own_evidence_corrupted=truth == corrupted)
            )
    return outcomes


def metrics(outcomes: list[Outcome]) -> dict:
    count = {v: sum(1 for o in outcomes if o.verdict == v) for v in ("TP", "FP", "FN", "TN")}
    tp, fp, fn, tn = count["TP"], count["FP"], count["FN"], count["TN"]
    return {
        **count,
        "precision": tp / (tp + fp) if tp + fp else 1.0,
        "recall": tp / (tp + fn) if tp + fn else 1.0,
        "false_positive_rate": fp / (fp + tn) if fp + tn else 0.0,
        "unresolved_rate": sum(1 for o in outcomes if o.predicted is None) / len(outcomes),
    }


if __name__ == "__main__":
    strict, recovered = run(False), run(True)
    print(f"{'case':58} {'truth':8} {'strict':18} {'recovery':24}")
    for s, r in zip(strict, recovered):
        mark = lambda o: f"{o.verdict}:{o.predicted or '-'}" + ("*" if o.flagged and o.predicted else "")  # noqa: E731
        print(f"{s.label:58} {str(s.truth):8} {mark(s):18} {mark(r):24}")
    for name, rows in (("STRICT", strict), ("RECOVERY", recovered)):
        m = metrics(rows)
        print(
            f"{name:9} TP={m['TP']} FP={m['FP']} FN={m['FN']} TN={m['TN']} "
            f"precision={m['precision']:.3f} recall={m['recall']:.3f} "
            f"FPR={m['false_positive_rate']:.3f} unresolved={m['unresolved_rate']:.3f}"
        )
