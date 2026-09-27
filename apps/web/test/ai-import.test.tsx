/**
 * AI reading on the device: the reply is the document's own values, it lands
 * in the ordinary review, and nothing is saved until the student confirms.
 *
 * The server is stubbed; the AI never runs here. SYNTHETIC CONTENT ONLY.
 */

import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiResultCard, AiReview, AiTimetable } from '@gradtools/shared-types';
import {
  AI_SOURCE_PREFIX,
  aiResultToParsedCard,
  aiTimetableToParsed,
} from '../src/domain/ai-import.js';
import { DocumentImport } from '../src/features/import/DocumentImport.js';
import { AuthContextValueProvider } from './helpers/auth-harness.js';
import { createMemoryRepositories, renderWith } from './helpers.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CARD: AiResultCard = {
  institutionName: null,
  institutionCode: null,
  schemeText: null,
  programmeText: null,
  branchText: null,
  semester: 4,
  examinationSession: 'June/July 2026',
  studentIdentifierPresent: true,
  courses: [
    {
      sourceCourseCode: 'BCS401',
      sourceCourseName: 'ANALYSIS & DESIGN OF ALGORITHMS',
      sourceInternalMarks: 44,
      sourceExternalMarks: 36,
      sourceTotalMarks: 80,
      sourceCredits: null,
      sourceGrade: null,
      sourceResultStatus: 'P',
      sourceText: 'BCS401 ANALYSIS & DESIGN OF ALGORITHMS 44 36 80 P',
    },
    {
      sourceCourseCode: '18CS51',
      sourceCourseName: 'MANAGEMENT',
      sourceInternalMarks: 30,
      sourceExternalMarks: 40,
      sourceTotalMarks: 70,
      sourceCredits: null,
      sourceGrade: null,
      sourceResultStatus: 'P',
      sourceText: null,
    },
  ],
};

const session = (
  over: Partial<AiTimetable['sessions'][number]>,
): AiTimetable['sessions'][number] => ({
  day: 'MONDAY',
  startTime: '10:00',
  endTime: '10:55',
  subjectCode: null,
  subjectName: null,
  batch: null,
  room: null,
  faculty: null,
  activityType: 'LECTURE',
  sourceText: null,
  ...over,
});

const TABLE: AiTimetable = {
  institutionName: 'S. G. BALEKUNDRI INSTITUTE OF TECHNOLOGY',
  institutionCode: null,
  department: null,
  programme: null,
  classText: 'V (B)',
  semester: 5,
  academicYear: '2026-27',
  effectiveFrom: '2026-09-12',
  effectiveTo: null,
  sessions: [
    session({ subjectName: 'CN', room: 'LH-302' }),
    session({ day: 'TUESDAY', subjectName: 'TOC-T', startTime: '15:10', endTime: '16:05' }),
    session({ day: 'WEDNESDAY', subjectName: 'CNL-B1 OJAS', batch: 'B1', activityType: 'LAB' }),
    session({ day: 'SUNDAY', subjectName: 'CN' }),
    session({
      day: 'MONDAY',
      subjectName: 'SHORT BREAK',
      activityType: 'BREAK',
      startTime: '11:50',
      endTime: '12:10',
    }),
  ],
  subjects: [
    { subjectCode: 'BCS502', subjectName: 'Computer Networks (CN)', faculty: 'Prof. B. Sample' },
    { subjectCode: 'BCS503', subjectName: 'Theory of Computation (TOC)', faculty: null },
  ],
};

describe('an AI result card, as the review reads it', () => {
  it('carries only what the document printed, labelled as read by AI', () => {
    const card = aiResultToParsedCard(CARD, 'vtu-2022');
    expect(card.semester).toBe(4);
    expect(card.rows[0]).toMatchObject({
      subjectCode: 'BCS401',
      internal: 44,
      external: 36,
      total: 80,
      resultStatus: 'P',
    });
    expect(card.rows[0]?.sourceLine.startsWith(AI_SOURCE_PREFIX)).toBe(true);
    // No seat number is taken, and nothing beyond the source values exists here.
    expect(card.seatNumber).toBeNull();
    expect(Object.keys(card.rows[0] ?? {})).not.toContain('credits');
  });

  it('compares each code with the student’s scheme, exactly as the on-device path does', () => {
    const card = aiResultToParsedCard(CARD, 'vtu-2022');
    expect(card.rows[1]?.warnings.map((warning) => warning.kind)).toEqual(['scheme_mismatch']);
  });

  it('refuses to file a semester outside 1–8 under any semester', () => {
    const card = aiResultToParsedCard({ ...CARD, semester: 9 }, 'vtu-2022');
    expect(card).toMatchObject({ semester: null, unsupportedSemester: 9 });
  });
});

describe('an AI timetable, as the review reads it', () => {
  const { parsed } = aiTimetableToParsed(TABLE);

  it('ties cells to codes through the document’s own legend, never the model’s word', () => {
    const monday = parsed.classes.find((entry) => entry.day === 'Mon');
    expect(monday).toMatchObject({ subjectCode: 'BCS502', resolution: 'declared', room: 'LH-302' });
    // "TOC-T" is a tutorial of TOC: resolved through the part before the dash.
    expect(parsed.classes.find((entry) => entry.day === 'Tue')?.subjectCode).toBe('BCS503');
  });

  it('leaves a cell unresolved rather than guessing', () => {
    const lab = parsed.classes.find((entry) => entry.day === 'Wed');
    expect(lab).toMatchObject({ subjectCode: null, batch: 'B1' });
    expect(lab?.unresolvedReason).not.toBeNull();
  });

  it('keeps breaks out of the classes, says what it left out, and flags a thin week', () => {
    expect(parsed.classes.map((entry) => entry.day)).toEqual(['Mon', 'Tue', 'Wed']);
    expect(parsed.warnings.join(' ')).toMatch(/sunday session was read and left out/i);
    expect(parsed.coverage.looksComplete).toBe(false);
  });
});

/* -- The import screen ------------------------------------------------------ */

function review(over: Partial<AiReview>): AiReview {
  return {
    recognition: 'RECOGNIZED',
    evidence: ['The heading names VTU.'],
    documentType: 'RESULT_CARD',
    resultCard: CARD,
    timetable: null,
    model: 'gemini-2.5-flash',
    ...over,
  };
}

function serve(reply: AiReview | null) {
  const calls: { url: string; init?: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/api/v1/me/documents/extract') && reply !== null) {
        return new Response(JSON.stringify(reply), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

async function addPhoto() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'card.jpg', {
    type: 'image/jpeg',
  });
  Object.defineProperty(input, 'files', {
    value: {
      0: file,
      length: 1,
      item: () => file,
      [Symbol.iterator]: [file][Symbol.iterator].bind([file]),
    },
    configurable: true,
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function renderImport(signedIn: boolean) {
  const { bundle, peek } = createMemoryRepositories();
  renderWith(
    <AuthContextValueProvider signedIn={signedIn}>
      <DocumentImport onDone={() => undefined} />
    </AuthContextValueProvider>,
    { repositories: bundle },
  );
  return peek;
}

describe('reading with AI', () => {
  it('is not offered to a student who is not signed in', async () => {
    serve(null);
    renderImport(false);
    await screen.findByText(/drag a document here/i);
    expect(screen.queryByRole('switch', { name: /read with ai/i })).toBeNull();
  });

  it('is off until turned on, and says where the document goes', async () => {
    const calls = serve(review({}));
    renderImport(true);
    const toggle = await screen.findByRole('switch', { name: /read with ai/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/Google’s Gemini AI service/)).toBeTruthy();

    // Off: the photo is read on the device and nothing is sent anywhere.
    await addPhoto();
    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/documents/extract'))).toBe(false);
    });
  });

  it('sends the file with the session, lands in review, and saves only on confirm', async () => {
    // One course of the student's own scheme (a mismatched one blocks saving, by design).
    const calls = serve(review({ resultCard: { ...CARD, courses: [CARD.courses[0]!] } }));
    const peek = renderImport(true);
    await userEvent.setup().click(await screen.findByRole('switch', { name: /read with ai/i }));
    await addPhoto();

    expect(await screen.findByText(/rows · read by AI/i)).toBeTruthy();
    const sent = calls.find((call) => call.url.endsWith('/api/v1/me/documents/extract'));
    expect(new Headers(sent?.init?.headers).get('Authorization')).toBe('Bearer synthetic-token');
    // Reviewed, not saved: nothing is recorded until the student confirms.
    expect(screen.queryByText(/data confirmed and recorded/i)).toBeNull();

    await userEvent.setup().click(await screen.findByRole('button', { name: /confirm and save/i }));
    /*
     * Signed in, the record goes to the account's own local scope (not the
     * anonymous memory store `peek` reads), so the save is asserted by what the
     * screen confirms it wrote.
     */
    expect(await screen.findByText(/data confirmed and recorded/i)).toBeTruthy();
    expect(screen.getByText(/semester 4 and its 1 subject/i)).toBeTruthy();
    void peek;
  });

  it('turns an unrecognised document away, with the gate’s reason', async () => {
    serve(
      review({
        recognition: 'UNRECOGNIZED_DOCUMENT',
        documentType: null,
        resultCard: null,
        evidence: ['Nothing links this document to VTU or a VTU-affiliated college.'],
      }),
    );
    const peek = renderImport(true);
    await userEvent.setup().click(await screen.findByRole('switch', { name: /read with ai/i }));
    await addPhoto();
    expect(await screen.findByText(/could not recognise this as a VTU result card/i)).toBeTruthy();
    expect(peek.results()).toHaveLength(0);
  });
});
