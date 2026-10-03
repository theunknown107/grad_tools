/**
 * GradTools document benchmark for free OpenRouter models — SYNTHETIC FIXTURES
 * ONLY, one inference request per model per fixture, no retries.
 *
 *   OPENROUTER_API_KEY in the environment (never printed)
 *   tsx scripts/document-ai-benchmark.ts <model> [<model> ...]
 *
 * Every request goes through the real reader, so the live $0 check runs before
 * each one. A model whose free endpoint offers zero data retention is called
 * with the production privacy routing; any other only because these documents
 * are synthetic. Scores compare against what the fixtures actually print.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiReview } from '@gradtools/shared-types';
import { createOpenRouterReader, fetchAssessment } from '../src/documents/openrouter.js';
import { DocumentReadError, readDocument } from '../src/documents/read.js';

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined || apiKey === '') {
  console.error('OPENROUTER_API_KEY is not set in this environment.');
  process.exit(2);
}
const models = process.argv.slice(2);
const here = fileURLToPath(new URL('.', import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(here, '..', 'test', 'fixtures', 'documents', `${name}.png`));

/* What the synthetic result card prints. Grade and credits are NOT printed. */
const COURSES = [
  ['BCS401', 'ANALYSIS & DESIGN OF ALGORITHMS', 44, 36, 80, 'P'],
  ['BCS402', 'MICROCONTROLLERS', 41, 30, 71, 'P'],
  ['BCS403', 'DATABASE MANAGEMENT SYSTEMS', 38, 12, 50, 'F'],
  ['BBOC407', 'BIOLOGY FOR COMPUTER ENGINEERS', 45, 40, 85, 'P'],
] as const;

/* What the synthetic timetable prints: day, start, end, cell text, room. */
const L = 'LH-302';
const SESSIONS: [string, string, string, string, string | null][] = [
  ['MONDAY', '10:00', '10:55', 'RMIPR', L],
  ['MONDAY', '10:55', '11:50', 'CN', L],
  ['MONDAY', '12:10', '13:05', 'FM', L],
  ['MONDAY', '13:05', '14:00', 'TOC-T', L],
  ['MONDAY', '15:10', '17:00', 'Mini project', null],
  ['TUESDAY', '10:00', '10:55', 'CN', L],
  ['TUESDAY', '10:55', '11:50', 'RMIPR', L],
  ['TUESDAY', '12:10', '13:05', 'TOC', L],
  ['TUESDAY', '13:05', '14:00', 'Value added Course', L],
  ['TUESDAY', '15:10', '16:05', 'ESEVM', null],
  ['TUESDAY', '16:05', '17:00', 'TOC-T', null],
  ['WEDNESDAY', '10:00', '10:55', 'FM', L],
  ['WEDNESDAY', '10:55', '11:50', 'MRMM', L],
  ['WEDNESDAY', '12:10', '13:05', 'TOC', L],
  ['WEDNESDAY', '13:05', '14:00', 'Value added Course', null],
  ['WEDNESDAY', '15:10', '17:00', 'CNL-B1 OJAS', null],
  ['THURSDAY', '10:00', '10:55', 'RMIPR', L],
  ['THURSDAY', '10:55', '11:50', 'MRMM', L],
  ['THURSDAY', '12:10', '13:05', 'TOC', L],
  ['THURSDAY', '13:05', '14:00', 'ESEVM', null],
  ['THURSDAY', '15:10', '17:00', 'CNL-B2 OJAS', null],
];
const LEGEND = [
  ['BCB501', 'Prof. A. Example'],
  ['BCS502', 'Prof. B. Sample'],
  ['BCS503', 'Dr. C. Placeholder'],
  ['BRMK557', 'Prof. D. Fictional'],
] as const;

const norm = (text: string | null | undefined) =>
  (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const leaked = (review: AiReview) => /1XX22CS001|TEST STUDENT/i.test(JSON.stringify(review));

function scoreResult(review: AiReview) {
  const card = review.resultCard;
  if (card === null)
    return { fields: '0/26', hallucinations: 0, missingOk: '-', notes: review.recognition };
  let right =
    Number(card.semester === 4) + Number(norm(card.examinationSession) === norm('June/July 2026'));
  let hallucinations = card.courses.length > 4 ? card.courses.length - 4 : 0;
  let nullsKept = 0;
  for (const [code, name, internal, external, total, status] of COURSES) {
    const row = card.courses.find((course) => norm(course.sourceCourseCode) === code);
    if (row === undefined) continue;
    right +=
      1 +
      Number(norm(row.sourceCourseName) === norm(name)) +
      Number(row.sourceInternalMarks === internal) +
      Number(row.sourceExternalMarks === external) +
      Number(row.sourceTotalMarks === total) +
      Number(norm(row.sourceResultStatus) === status);
    if (row.sourceGrade === null && row.sourceCredits === null) nullsKept += 1;
    else hallucinations += 1;
  }
  if (leaked(review)) hallucinations += 1;
  return {
    fields: `${String(right)}/26`,
    hallucinations,
    missingOk: `${String(nullsKept)}/4 rows kept grade+credits null`,
    notes: `${review.recognition}${leaked(review) ? ', COPIED IDENTIFIER' : ''}`,
  };
}

function scoreTimetable(review: AiReview) {
  const table = review.timetable;
  if (table === null)
    return { fields: '0/21', hallucinations: 0, missingOk: '-', notes: review.recognition };
  const taught = table.sessions.filter(
    (s) => s.activityType !== 'BREAK' && !/BREAK/i.test(s.subjectName ?? ''),
  );
  let times = 0,
    subjects = 0,
    rooms = 0,
    hallucinations = 0,
    labs = 0;
  for (const [day, start, end, text, room] of SESSIONS) {
    const hit = taught.find((s) => s.day === day && s.startTime === start && s.endTime === end);
    if (hit === undefined) continue;
    times += 1;
    if (norm(hit.subjectName).includes(norm(text).slice(0, 5))) subjects += 1;
    if ((hit.room ?? null) === room) rooms += 1;
    if (/^CNL/.test(text) && hit.activityType === 'LAB') labs += 1;
  }
  const extra = taught.filter(
    (s) => !SESSIONS.some(([d, a, b]) => s.day === d && s.startTime === a && s.endTime === b),
  ).length;
  const inferred = taught.filter((s) => s.subjectCode !== null || s.faculty !== null).length;
  hallucinations = extra + inferred + (leaked(review) ? 1 : 0);
  const legend = LEGEND.filter(([code, faculty]) =>
    table.subjects.some((s) => norm(s.subjectCode) === code && norm(s.faculty) === norm(faculty)),
  ).length;
  return {
    fields: `times ${String(times)}/21, cell text ${String(subjects)}/21, rooms ${String(rooms)}/21, legend ${String(legend)}/4, labs ${String(labs)}/2`,
    hallucinations,
    missingOk: `${String(inferred)} cells given a code/teacher the cell does not print; ${String(extra)} extra sessions`,
    notes: review.recognition,
  };
}

const rows = [];
for (const model of models) {
  const assessment = await fetchAssessment(model, true, AbortSignal.timeout(30_000));
  const requireZdr = assessment.eligible;
  for (const [name, score] of [
    ['result-card', scoreResult],
    ['timetable', scoreTimetable],
  ] as const) {
    const reader = createOpenRouterReader({
      apiKey,
      models: [model],
      requireZdr,
      log: (event) => console.error('  diag', JSON.stringify(event)),
    });
    const started = Date.now();
    try {
      const review = await readDocument(fixture(name), reader, model);
      rows.push({
        model,
        input: name,
        ms: Date.now() - started,
        schema: 'valid',
        zdr: requireZdr,
        ...score(review),
      });
    } catch (error) {
      const failure = error instanceof DocumentReadError ? error.failure : 'error';
      rows.push({
        model,
        input: name,
        ms: Date.now() - started,
        schema: failure === 'invalid_reply' ? 'INVALID' : '-',
        zdr: requireZdr,
        fields: '-',
        hallucinations: '-',
        missingOk: '-',
        notes: failure,
      });
    }
  }
}
console.log(JSON.stringify(rows, null, 1));
