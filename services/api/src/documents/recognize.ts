/**
 * Is this a document GradTools supports? Decided here — deterministically —
 * never by the model.
 *
 * The model says what KIND of document it thinks it read. That is a claim,
 * not evidence. This gate looks for evidence GradTools controls:
 *
 *   structure   a result card with at least one course carrying marks, or a
 *               timetable with at least one session carrying a day and times;
 *   VTU         the university's name or "affiliated to VTU" in the heading;
 *   institution the institution named matches a college in the transcribed
 *               VTU-affiliated list (@gradtools/vtu-catalogue);
 *   codes       course codes whose shape is a known VTU scheme family.
 *
 * No structure → UNRECOGNIZED_DOCUMENT, whatever else is present. Structure
 * plus two kinds of evidence → RECOGNIZED; plus one → NEEDS_REVIEW (the
 * student is asked to check it); plus none → UNRECOGNIZED_DOCUMENT.
 *
 * RECOGNIZED never means "official". It means "shaped like a VTU document
 * GradTools can read" — nothing here can verify a document's authenticity,
 * and nothing says so.
 */

import type { AiDocumentType, AiExtraction, AiRecognition } from '@gradtools/shared-types';
import { codeScheme } from '@gradtools/vtu-catalogue';
import { VTU_COLLEGES } from '@gradtools/vtu-catalogue/data';

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');

/** "Visvesvaraya Technological University", or "affiliated to VTU" / "V T U". */
export function mentionsVtu(text: string): boolean {
  const compact = words(text).join('');
  return (
    compact.includes('visvesvarayatechnologicaluniversity') ||
    compact.includes('affiliatedtovtu') ||
    words(text).includes('vtu')
  );
}

/**
 * A printed institution name matches a catalogue college when every word of
 * the catalogue's (often abbreviated) name starts the corresponding printed
 * word, in order: "S G BALEKUNDRI INST. OF TECH" matches "S. G. BALEKUNDRI
 * INSTITUTE OF TECHNOLOGY". Deliberately strict — a near miss is no evidence.
 */
export function matchesCollege(printed: string, catalogue: string): boolean {
  const said = words(printed);
  const known = words(catalogue);
  if (known.length < 3) return false;
  for (let start = 0; start + known.length <= said.length; start += 1) {
    if (known.every((word, at) => (said[start + at] ?? '').startsWith(word))) return true;
  }
  return false;
}

export interface RecognitionOutcome {
  readonly recognition: AiRecognition;
  readonly documentType: AiDocumentType | null;
  readonly evidence: readonly string[];
}

export function recognize(extraction: AiExtraction): RecognitionOutcome {
  const unrecognized = (reason: string): RecognitionOutcome => ({
    recognition: 'UNRECOGNIZED_DOCUMENT',
    documentType: null,
    evidence: [reason],
  });

  let documentType: AiDocumentType;
  let institution: string | null;
  let codes: (string | null)[];
  if (extraction.documentType === 'RESULT_CARD' && extraction.resultCard !== null) {
    const card = extraction.resultCard;
    const structured = card.courses.some(
      (course) =>
        (course.sourceCourseCode !== null || course.sourceCourseName !== null) &&
        (course.sourceTotalMarks !== null ||
          course.sourceInternalMarks !== null ||
          course.sourceExternalMarks !== null ||
          course.sourceGrade !== null),
    );
    if (!structured) return unrecognized('No course row with marks or a grade was found.');
    documentType = 'RESULT_CARD';
    institution = card.institutionName;
    codes = card.courses.map((course) => course.sourceCourseCode);
  } else if (extraction.documentType === 'TIMETABLE' && extraction.timetable !== null) {
    const table = extraction.timetable;
    const structured = table.sessions.some(
      (session) => session.day !== null && session.startTime !== null && session.endTime !== null,
    );
    if (!structured) return unrecognized('No timetable session with a day and times was found.');
    documentType = 'TIMETABLE';
    institution = table.institutionName;
    codes = [
      ...table.sessions.map((session) => session.subjectCode),
      ...table.subjects.map((subject) => subject.subjectCode),
    ];
  } else {
    return unrecognized('Not a result card or a class timetable.');
  }

  const evidence: string[] = [];
  const heading = [extraction.headerText ?? '', institution ?? ''].join(' ');
  if (mentionsVtu(heading)) evidence.push('The heading names VTU.');

  const college =
    institution === null
      ? undefined
      : VTU_COLLEGES.entries.find((entry) => matchesCollege(institution, entry.name));
  if (college !== undefined) {
    evidence.push(`The institution matches ${college.name} in the VTU-affiliated college list.`);
  }

  const printedCodes = codes.filter((code): code is string => code !== null);
  const vtuCodes = printedCodes.filter((code) => codeScheme(code) !== null);
  if (vtuCodes.length > 0 && vtuCodes.length * 2 >= printedCodes.length) {
    evidence.push(`${String(vtuCodes.length)} course codes have a VTU scheme's shape.`);
  }

  const recognition: AiRecognition =
    evidence.length >= 2
      ? 'RECOGNIZED'
      : evidence.length === 1
        ? 'NEEDS_REVIEW'
        : 'UNRECOGNIZED_DOCUMENT';
  return {
    recognition,
    documentType: recognition === 'UNRECOGNIZED_DOCUMENT' ? null : documentType,
    evidence:
      evidence.length === 0
        ? ['Nothing links this document to VTU or a VTU-affiliated college.']
        : evidence,
  };
}
