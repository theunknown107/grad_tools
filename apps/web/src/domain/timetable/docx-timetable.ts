/**
 * Class timetables from a Word file's own TABLES (see lib/docx-structure).
 *
 * The grid is read as the document lays it out — Day → time slot → cell →
 * subject/room/batch — instead of from flattened text:
 *
 *  - TIME SLOTS come from the header row's cells and their real x extent in the
 *    table grid. A body cell belongs to the slots it OVERLAPS by a meaningful
 *    amount; a sliver column a word processor inserted (a few twips) does not
 *    pull a class into the neighbouring hour.
 *  - A DAY is the cell in the first column naming a weekday. Its vertical merge
 *    covers the day's rows: the first carries subjects, the rows beneath carry
 *    rooms. A room is never a class and never a subject.
 *  - A merged cell spanning two slots is ONE class over both, unless it prints
 *    as many subject tokens as it spans and the row beneath prints that many
 *    rooms — then each token takes its own slot.
 *  - A batch tag ("CN-A2", "CNL-B1") stays on its class; it is not a subject.
 *  - SUBJECTS resolve only through this document's own subject table
 *    (`resolveGridSubject`). A lab cell is never confirmed automatically: the
 *    page does not say which course a lab session belongs to, so a lab match is
 *    offered for checking (`near`) with its reason.
 *
 * Each grid table is returned as its own timetable with the section label the
 * document printed before it ("V (A)"), because one Word file can hold several
 * classes' timetables and they must never be merged.
 */

import type { DocxCell, DocxStructure, DocxTable } from './docx-structure.js';
import {
  DAY_NAMES,
  readContext,
  readSlot,
  resolveGridSubject,
  type DictionaryEntry,
  type GridClass,
  type ParsedTimetable,
  type TimeSlot,
  type TimetableConflict,
} from './timetable-import.js';
import type { Weekday } from './primitives.js';

export interface DocxTimetableSection {
  /** As printed before the table, e.g. "V (A)"; null when nothing was. */
  readonly label: string | null;
  readonly tableIndex: number;
  readonly timetable: ParsedTimetable;
}

const textOf = (cell: DocxCell) =>
  [...cell.paragraphs, ...cell.nested].join(' ').replace(/\s+/g, ' ').trim();
const squash = (s: string) => s.replace(/\s+/g, '').toUpperCase();
const BREAK = /^(SHORTBREAK|LUNCHBREAK|BREAK|LUNCH|RECESS|INTERVAL|TEABREAK)$/;
const ROOM = /^(?:[A-Z]{1,3}\s*-?\s*\d{2,4}[A-Z]?|ROOM\s*\S+)$/i;
const CODE = /^\s*(\d{0,2}[A-Z]{2,7}\d{3}[A-Z]?)\b/;
const BATCH = /(?:^|[\s\-(/,])([A-H]\d)\b/g;
const LAB_MARK = /\bLAB\b|^[A-Z]{2,6}L(?:[\s-]|$)/i;
const dayOf = (text: string): Weekday | undefined =>
  DAY_NAMES[text.replace(/[^A-Za-z]/g, '').toLowerCase()];

function overlap(cell: DocxCell, slot: TimeSlot): number {
  return Math.min(cell.x1, slot.right) - Math.max(cell.x0, slot.left);
}

/** Slots a cell genuinely covers: at least a quarter of the narrower of the two, never a sliver. */
function covered(cell: DocxCell, slots: readonly TimeSlot[]): TimeSlot[] {
  return slots.filter((slot) => {
    const o = overlap(cell, slot);
    return o > 0 && o >= Math.max(40, 0.25 * Math.min(cell.x1 - cell.x0, slot.right - slot.left));
  });
}

/** The subject table: rows that start with a course code, anywhere in the document's tables. */
function dictionaryOf(tables: readonly DocxTable[]): DictionaryEntry[] {
  const out = new Map<string, DictionaryEntry>();
  for (const table of tables) {
    for (const row of table.rows) {
      const first = row[0];
      if (first === undefined) continue;
      const text = textOf(first);
      const match = CODE.exec(text);
      if (match === null) continue;
      const code = match[1] as string;
      let title = text.slice(match[0].length).replace(/^[\s\-–:/]+/, '');
      /* "BNSK559/BPEK559/BYOK559 NSS/PE/YOGA": the alternative codes are not the title. */
      title = title
        .replace(/^(?:[/\s]*\d{0,2}[A-Z]{2,7}\d{3}[A-Z]?)+/, '')
        .replace(/^[\s\-–:/]+/, '')
        .trim();
      if (title === '' && row[1] !== undefined) title = textOf(row[1]);
      if (!/[A-Za-z]{3}/.test(title) || out.has(code)) continue;
      out.set(code, {
        subjectCode: code,
        title,
        initials: null,
        faculty: null,
        collegeHours: null,
        schemeHours: null,
      });
    }
  }
  return [...out.values()];
}

/** A cell's subject token resolved against this document's subject table, with the lab rule. */
function resolve(dictionary: readonly DictionaryEntry[], token: string, cellText: string) {
  const isLab = LAB_MARK.test(cellText) || LAB_MARK.test(token);
  const labs = dictionary.filter((e) => /\blab\b/i.test(e.title));
  const theory = dictionary.filter((e) => !/\blab\b/i.test(e.title));
  const base =
    token
      .replace(/\s*LAB\b.*$/i, '')
      .replace(/^([A-Z]{2,6})L$/, '$1')
      .trim() || token;
  if (isLab) {
    /*
     * CONFIRMED ONLY WHEN THE CELL SPELLS THE LAB OUT: the word before "LAB" is
     * the full initials of exactly one lab title, "Lab" included ("CSL LAB" =
     * Computational Statistics Lab). "DSP LAB", "CN Lab" and "CNL-B1" do not
     * meet this and stay suggestions — the page never says which course they are.
     */
    const spelled = /^([A-Z]{2,6})\s+LAB\b/i.exec(token.trim())?.[1];
    if (spelled !== undefined) {
      const exact = resolveGridSubject(labs, spelled.toUpperCase());
      if (exact.subjectCode !== null && exact.resolution !== 'near') return exact;
    }
    const asLab = resolveGridSubject(
      labs.map((e) => ({ ...e, title: e.title.replace(/\s*lab(oratory)?\s*$/i, '') })),
      base,
    );
    if (asLab.subjectCode !== null) {
      return {
        subjectCode: asLab.subjectCode,
        resolution: 'near' as const,
        reason: `"${token}" is a lab session; this timetable does not state which course it belongs to. ${asLab.subjectCode} is the closest lab — check it.`,
      };
    }
    return {
      subjectCode: null,
      resolution: 'unknown' as const,
      reason: `"${token}" is a lab session this timetable does not link to a course.`,
    };
  }
  const direct = resolveGridSubject(dictionary, token);
  if (direct.resolution !== 'ambiguous') return direct;
  /* A cell with no lab marker is the theory course: "CN" is Computer Networks, not its Lab. */
  const onlyTheory = resolveGridSubject(theory, token);
  return onlyTheory.subjectCode !== null ? onlyTheory : direct;
}

function batchesIn(text: string): string[] {
  return [...new Set([...text.toUpperCase().matchAll(BATCH)].map((m) => m[1] as string))];
}

function buildSection(
  table: DocxTable,
  label: string | null,
  heading: string,
  dictionary: readonly DictionaryEntry[],
): ParsedTimetable | null {
  const rows = table.rows;
  const dayRows: { r: number; day: Weekday; cell: DocxCell }[] = [];
  rows.forEach((row, r) => {
    const first = row[0];
    if (first === undefined || first.colStart !== 0) return;
    const day = dayOf(textOf(first));
    if (day !== undefined) dayRows.push({ r, day, cell: first });
  });
  if (dayRows.length < 2) return null;
  const firstDay = (dayRows[0] as { r: number }).r;

  /* The header: the last row above the first day whose cells hold time ranges. */
  let slots: TimeSlot[] = [];
  for (let r = 0; r < firstDay; r += 1) {
    const found = (rows[r] ?? [])
      .map((cell) => ({ cell, slot: readSlot(cell.paragraphs.join(' ')) }))
      .filter((x) => x.slot !== null)
      .map(({ cell, slot }) => ({
        start: slot!.start,
        end: slot!.end,
        left: cell.x0,
        right: cell.x1,
        isBreak: false,
      }));
    if (found.length >= 2) slots = found;
  }
  if (slots.length < 2) return null;
  /* A column whose body cells say BREAK is a break, not a class (§19). */
  const breakCells = rows[firstDay]?.filter((cell) => BREAK.test(squash(textOf(cell)))) ?? [];
  slots = slots.map((slot) => ({
    ...slot,
    isBreak: breakCells.some((cell) => overlap(cell, slot) > 0.5 * (slot.right - slot.left)),
  }));
  const teachingSlots = slots.filter((s) => !s.isBreak);

  const classes: GridClass[] = [];
  const warnings: string[] = [];
  for (const { r, day, cell: dayCell } of dayRows) {
    const below = rows.slice(r + 1, r + dayCell.rowSpan).flat();
    for (const cell of rows[r] ?? []) {
      if (cell === dayCell) continue;
      const text = textOf(cell);
      if (text === '' || BREAK.test(squash(text)) || ROOM.test(text)) continue;
      const over = covered(cell, teachingSlots);
      if (over.length === 0) {
        warnings.push(`A cell on ${day} ("${text}") could not be placed under a time.`);
        continue;
      }
      const roomsBelow = (slot: TimeSlot) =>
        below
          .filter(
            (c) =>
              ROOM.test(textOf(c)) &&
              (c.x0 + c.x1) / 2 >= slot.left &&
              (c.x0 + c.x1) / 2 < slot.right,
          )
          .map(textOf);
      const inCellRoom = cell.paragraphs.slice(1).find((p) => ROOM.test(p)) ?? null;
      const head = cell.paragraphs[0] ?? text;
      const tokens = head.split(/\s+/).filter((t) => /^[A-Za-z][A-Za-z&-]{1,}$/.test(t));
      const perSlot =
        over.length > 1 &&
        tokens.length === over.length &&
        over.every((slot) => roomsBelow(slot).length === 1);
      const parts = perSlot
        ? tokens.map((t, i) => ({ token: t, slots: [over[i] as TimeSlot] }))
        : [{ token: head, slots: over }];
      for (const part of parts) {
        const first = part.slots[0] as TimeSlot;
        const last = part.slots[part.slots.length - 1] as TimeSlot;
        const tags = batchesIn(text);
        /* "---CN-A1", "---Mini project---": decorative dashes and the batch tag are not the subject. */
        const bare = part.token.replace(/^[-–—\s]+|[-–—\s]+$/g, '');
        const subjectToken =
          bare
            .replace(/-?[A-H]\d\b.*$/i, '')
            .replace(/\s*\(.*$/, '')
            .replace(/[-–—\s]+$/g, '')
            .trim() || bare;
        const room = roomsBelow(first)[0] ?? inCellRoom;
        for (const batch of tags.length > 0 ? tags : [null]) {
          const resolved = resolve(dictionary, subjectToken, text);
          classes.push({
            day,
            start: first.start,
            end: last.end,
            subjectCode: resolved.subjectCode,
            resolution: resolved.resolution,
            unresolvedReason: resolved.reason,
            initials: subjectToken,
            batch,
            room: room ?? null,
            spansSlots: part.slots.length,
            sourceText: text,
          });
        }
      }
    }
  }

  const conflicts: TimetableConflict[] = [];
  const seen = new Map<string, GridClass[]>();
  for (const c of classes) {
    const key = `${c.day}|${c.start}|${c.batch ?? ''}`;
    seen.set(key, [...(seen.get(key) ?? []), c]);
  }
  for (const group of seen.values()) {
    if (group.length > 1 && new Set(group.map((c) => c.initials)).size > 1) {
      const g = group[0] as GridClass;
      conflicts.push({
        day: g.day,
        start: g.start,
        batch: g.batch,
        initials: group.map((c) => c.initials),
      });
    }
  }
  const resolved = classes.filter((c) => c.subjectCode !== null && c.resolution !== 'near').length;
  const daysSeen = new Set(classes.map((c) => c.day)).size;
  const context = readContext(heading);
  return {
    context: { ...context, className: context.className ?? label },
    slots,
    dictionary,
    classes,
    batches: [...new Set(classes.flatMap((c) => (c.batch === null ? [] : [c.batch])))].sort(),
    conflicts,
    coverage: {
      cellsFound: classes.length,
      cellsResolved: resolved,
      slotsFound: slots.length,
      dictionaryEntries: dictionary.length,
      looksComplete: classes.length > 0 && teachingSlots.length >= 4 && daysSeen >= 3,
    },
    warnings,
  };
}

/** Every class timetable a Word document's tables hold, in document order. Empty when none. */
export function docxTimetables(structure: DocxStructure): DocxTimetableSection[] {
  const tables = structure.blocks.flatMap((b) => (b.kind === 'table' ? [b.table] : []));
  const out: DocxTimetableSection[] = [];
  let heading: string[] = [];
  const dictionaryFor = (table: DocxTable) => {
    const own = dictionaryOf([table]);
    return own.length > 0 ? own : dictionaryOf(tables);
  };
  for (const block of structure.blocks) {
    if (block.kind === 'paragraph') {
      if (block.text !== '') heading = [...heading.slice(-6), block.text];
      continue;
    }
    const text = heading.join('\n');
    const label = /\b([IVX]{1,4}\s*\(\s*[A-Z]\s*\))/.exec(text)?.[1]?.replace(/\s+/g, ' ') ?? null;
    const section = buildSection(block.table, label, text, dictionaryFor(block.table));
    if (section !== null) {
      out.push({ label, tableIndex: block.table.index, timetable: section });
      heading = [];
    }
  }
  return out;
}
