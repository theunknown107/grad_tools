/**
 * An AI reading, turned into what the existing reviews already understand.
 *
 * The AI returns SOURCE values only (@gradtools/shared-types, document-ai).
 * This maps them into the same `ParsedCard` / `ParsedTimetable` shapes the
 * on-device parser produces, so an AI reading goes through exactly the same
 * review: the same catalogue enrichment, the same deterministic rules, the
 * same provenance labels, the same conflicts, and the same explicit
 * confirmation before anything is saved. Nothing here computes an academic
 * figure or consults the catalogue — that happens after, in review, and says
 * where it came from.
 *
 * Timetable cells are tied to course codes by `resolveGridSubject` — the
 * on-device parser's own resolver — using the legend the document prints. The
 * model is never trusted to make that link itself.
 */

import type { AiResultCard, AiTimetable } from '@gradtools/shared-types';
import { fingerprintOf } from './calendar-import.js';
import type { ParsedCard, ParsedRow } from './result-import.js';
import { schemeCompatibility } from './scheme-compat.js';
import {
  resolveGridSubject,
  type DictionaryEntry,
  type GridClass,
  type ParsedTimetable,
  type TimeSlot,
} from './timetable-import.js';
import type { Weekday } from './types.js';

/** Where the review says an AI-read row came from. */
export const AI_SOURCE_PREFIX = 'Read by AI:';

export function aiResultToParsedCard(card: AiResultCard, profileSchemeId: string): ParsedCard {
  const rows: ParsedRow[] = card.courses.map((course) => {
    const code = (course.sourceCourseCode ?? '').replace(/\s+/g, '').toUpperCase();
    const compatibility = code === '' ? null : schemeCompatibility(code, profileSchemeId);
    return {
      subjectCode: code,
      subjectTitle: course.sourceCourseName ?? '',
      internal: course.sourceInternalMarks,
      external: course.sourceExternalMarks,
      total: course.sourceTotalMarks,
      resultStatus: course.sourceResultStatus,
      announcedOn: null,
      page: 1,
      sourceLine: `${AI_SOURCE_PREFIX} ${course.sourceText ?? [code, course.sourceCourseName].filter(Boolean).join(' ')}`,
      warnings:
        compatibility === null || compatibility.message === null
          ? []
          : [
              {
                kind:
                  compatibility.status === 'equivalence' ? 'equivalence_course' : 'scheme_mismatch',
                message: compatibility.message,
              },
            ],
    };
  });
  const semester = card.semester;
  const inRange = semester !== null && semester >= 1 && semester <= 8;
  return {
    semester: inRange ? semester : null,
    unsupportedSemester: semester !== null && !inRange ? semester : null,
    rows,
    unreadableRows: [],
    looksLikeResultCard: rows.length > 0,
    // Never taken from the document: the AI is told not to return identifiers.
    seatNumber: null,
    warnings: [],
  };
}

const DAYS: Readonly<Record<string, Weekday>> = {
  MONDAY: 'Mon',
  TUESDAY: 'Tue',
  WEDNESDAY: 'Wed',
  THURSDAY: 'Thu',
  FRIDAY: 'Fri',
  SATURDAY: 'Sat',
};

/** "Computer Networks (CN)" → title "Computer Networks", declared initials "CN". */
function legendEntry(subject: AiTimetable['subjects'][number]): DictionaryEntry | null {
  if (subject.subjectCode === null) return null;
  const name = subject.subjectName ?? '';
  const declared = /\(([A-Z][A-Z0-9&-]{1,9})\)\s*$/.exec(name);
  return {
    subjectCode: subject.subjectCode.replace(/\s+/g, '').toUpperCase(),
    title: declared === null ? name.trim() : name.slice(0, declared.index).trim(),
    initials: declared?.[1] ?? null,
    faculty: subject.faculty,
    collegeHours: null,
    schemeHours: null,
  };
}

export function aiTimetableToParsed(table: AiTimetable): {
  readonly parsed: ParsedTimetable;
  readonly fingerprint: string;
} {
  const dictionary = table.subjects.flatMap((subject) => {
    const entry = legendEntry(subject);
    return entry === null ? [] : [entry];
  });
  const warnings: string[] = [];
  const classes: GridClass[] = [];
  const slots = new Map<string, TimeSlot>();

  for (const session of table.sessions) {
    if (session.startTime === null || session.endTime === null) continue;
    const key = `${session.startTime}-${session.endTime}`;
    const isBreak = session.activityType === 'BREAK';
    if (!slots.has(key)) {
      slots.set(key, {
        start: session.startTime,
        end: session.endTime,
        left: 0,
        right: 0,
        isBreak,
      });
    }
    if (isBreak || session.day === null) continue;
    const day = DAYS[session.day];
    if (day === undefined) {
      warnings.push(
        `A ${session.day.toLowerCase()} session was read and left out: GradTools timetables run Monday to Saturday.`,
      );
      continue;
    }

    const printed = (session.subjectName ?? '').trim();
    const cellInitials = printed.split(/\s+/)[0] ?? '';
    let resolved =
      session.subjectCode !== null
        ? {
            subjectCode: session.subjectCode.replace(/\s+/g, '').toUpperCase(),
            resolution: 'declared' as const,
            reason: null,
          }
        : resolveGridSubject(dictionary, printed);
    if (resolved.subjectCode === null && cellInitials !== printed) {
      resolved = resolveGridSubject(dictionary, cellInitials);
    }
    if (resolved.subjectCode === null && cellInitials.includes('-')) {
      // "TOC-T" (a tutorial of TOC), "CNL-B1" (lab batch B1): the part before the dash.
      resolved = resolveGridSubject(dictionary, cellInitials.split('-')[0] ?? '');
    }

    classes.push({
      day,
      start: session.startTime,
      end: session.endTime,
      subjectCode: resolved.subjectCode,
      resolution: resolved.resolution,
      unresolvedReason: resolved.reason,
      initials: cellInitials === '' ? printed : cellInitials,
      batch: session.batch,
      room: session.room,
      spansSlots: 1,
      sourceText: `${AI_SOURCE_PREFIX} ${session.sourceText ?? printed}`,
    });
  }

  const parsed: ParsedTimetable = {
    context: {
      className: table.classText,
      semester: table.semester,
      academicYear: table.academicYear,
      revision: null,
      effectiveFrom: table.effectiveFrom,
      room: null,
    },
    slots: [...slots.values()].sort((a, b) => a.start.localeCompare(b.start)),
    dictionary,
    classes,
    batches: [...new Set(classes.flatMap((entry) => (entry.batch === null ? [] : [entry.batch])))],
    conflicts: [],
    coverage: {
      cellsFound: classes.length,
      cellsResolved: classes.filter((entry) => entry.subjectCode !== null).length,
      slotsFound: slots.size,
      dictionaryEntries: dictionary.length,
      /*
       * A week read with classes on fewer than five days is more likely a
       * partial reading than a light week — the device showed Thursday to
       * Saturday coming back empty — so the review is told to check it.
       */
      looksComplete: new Set(classes.map((entry) => entry.day)).size >= 5,
    },
    warnings,
  };
  /* The same identity the on-device path gives a document: its content. */
  const fingerprint = fingerprintOf(
    classes.map((entry) => ({ text: `${entry.day} ${entry.start} ${entry.initials}`, page: 1 })),
  );
  return { parsed, fingerprint };
}
