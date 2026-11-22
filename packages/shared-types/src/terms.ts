/**
 * Terms & Conditions: the single authoritative version, its content, and the
 * acceptance contract (TERMS-AND-ONBOARDING).
 *
 * ONE SOURCE OF TRUTH. `CURRENT_TERMS.version` is what a user's acceptance is
 * keyed on; bump it when the terms change and every user is asked to re-accept
 * (their profile is untouched). Acceptance is recorded server-side against this
 * exact version — never trusted from the client or localStorage.
 *
 * ---------------------------------------------------------------------------
 * DRAFTED FROM VERIFIED BEHAVIOUR ONLY — NOT LEGAL ADVICE
 * ---------------------------------------------------------------------------
 *
 * Every clause below describes how GradTools actually works (local-first
 * on-device storage; OPTIONAL cloud sync only when an account is used and a
 * provider is configured; OPTIONAL AI document reading; VTU-regulation-based
 * calculations; explicit non-affiliation with VTU). Nothing here invents a
 * legal entity, address, security guarantee, data-retention period, or privacy
 * commitment. There is NO separate Privacy Policy yet (see clause 8).
 *
 * `effectiveDate` is the DRAFTING date and MUST be set to the real publication
 * date before release. This document REQUIRES QUALIFIED LEGAL REVIEW before it
 * is relied upon; clauses needing that review are marked `legalReview: true`.
 */

import { z } from 'zod';

export interface TermsSection {
  readonly n: number;
  readonly heading: string;
  /** Paragraphs, rendered in order. Plain text — no markup. */
  readonly body: readonly string[];
  /** Flags a clause that a qualified lawyer must review before release. */
  readonly legalReview?: boolean;
}

export interface Terms {
  readonly version: string;
  /** ISO date (YYYY-MM-DD). DRAFTING date — confirm the real publication date before release. */
  readonly effectiveDate: string;
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly TermsSection[];
}

export const CURRENT_TERMS: Terms = {
  version: '1.0.0',
  effectiveDate: '2026-10-09',
  title: 'GradTools Terms & Conditions',
  intro:
    'These Terms & Conditions govern your use of GradTools. Please read them before continuing. GradTools is a student academic tool and is not a substitute for official university records.',
  sections: [
    {
      n: 1,
      heading: 'Acceptance of these Terms',
      body: [
        'By checking the acceptance box and continuing, you confirm that you have read and agree to these Terms & Conditions.',
        'If you do not agree, do not continue. You may sign out instead.',
        'These Terms apply each time a new version is published; you will be asked to accept the new version before continuing to use the application.',
      ],
    },
    {
      n: 2,
      heading: 'Eligibility and your account',
      body: [
        'You are responsible for the account you sign in with and for keeping access to it secure.',
        'GradTools does not manage your password directly; sign-in is handled by the configured authentication provider.',
        'You are responsible for activity carried out through your account.',
      ],
      legalReview: true,
    },
    {
      n: 3,
      heading: 'Accuracy of the information you enter',
      body: [
        'You are responsible for the accuracy of the details you enter, including your name, University Seat Number (USN), college, scheme, branch, and academic records.',
        'GradTools uses the information you provide to organise and calculate your academic figures; incorrect input will produce incorrect results.',
      ],
    },
    {
      n: 4,
      heading: 'What GradTools does',
      body: [
        'GradTools helps you record and understand your academic progress: results, SGPA/CGPA, attendance, a bunk planner, a timetable, and related tools.',
        'By default your data is stored locally on your own device. Signing in with an account enables OPTIONAL cloud sync so your data can move between your devices. If no account is used, nothing is sent anywhere.',
      ],
    },
    {
      n: 5,
      heading: 'Importing and reading documents',
      body: [
        'GradTools can read results and timetables from files you choose to import. Reading happens on your device where possible.',
        'An OPTIONAL AI document-reading feature may be available in some builds. It runs only when you use it and only when the operator has configured it; it is not enabled for every user.',
      ],
    },
    {
      n: 6,
      heading: 'Limitations of automated extraction',
      body: [
        'Automated reading of documents and photographs is imperfect. Extracted codes, titles, marks, dates, and timetable entries may be incomplete or incorrect, especially from low-quality scans or photos.',
        'GradTools surfaces items it is unsure about for your review rather than guessing, but it cannot guarantee correctness.',
      ],
    },
    {
      n: 7,
      heading: 'Your responsibility to review results',
      body: [
        'You must review the academic data GradTools extracts or calculates before relying on it.',
        'Official results and academic standing come from your university. GradTools is a convenience tool and is not an authoritative source.',
      ],
      legalReview: true,
    },
    {
      n: 8,
      heading: 'Data storage, processing, and deletion',
      body: [
        'Your academic data is stored locally on your device. If you sign in and enable sync, a copy is stored in the application database and is readable only by your own account.',
        'You can delete your account and its synced data from within the app; the copy on your device remains yours until you remove it.',
        'There is no separate Privacy Policy published yet. A full Privacy Policy describing data handling in detail is required and is pending; these Terms do not substitute for one.',
      ],
      legalReview: true,
    },
    {
      n: 9,
      heading: 'Third-party services',
      body: [
        'Depending on the build you use, GradTools may rely on third-party providers for authentication, cloud database hosting, and (optionally) AI document reading.',
        'Those providers process only what is necessary to deliver the feature you use, and are subject to their own terms. GradTools does not sell your data.',
      ],
      legalReview: true,
    },
    {
      n: 10,
      heading: 'Acceptable use',
      body: [
        'Use GradTools only for your own legitimate academic purposes.',
        'Do not attempt to access other users’ data, disrupt the service, upload malicious content, or misuse the application or its providers.',
      ],
    },
    {
      n: 11,
      heading: 'Service availability',
      body: [
        'GradTools is provided on an “as is” and “as available” basis. Local features work offline; cloud sync and any online features depend on connectivity and provider availability.',
        'The service may be unavailable during maintenance or for reasons outside our control.',
      ],
      legalReview: true,
    },
    {
      n: 12,
      heading: 'Intellectual property',
      body: [
        'The GradTools application, its name, and its original content are the property of the GradTools project. Your own academic data remains yours.',
        'GradTools is an independent student project and is NOT affiliated with, endorsed by, or connected to Visvesvaraya Technological University (VTU). Academic figures follow published VTU regulations, and each can show the clause it came from.',
      ],
      legalReview: true,
    },
    {
      n: 13,
      heading: 'Account termination',
      body: [
        'You may stop using GradTools and delete your account at any time.',
        'Access may be suspended or terminated for misuse of the application or its providers.',
      ],
      legalReview: true,
    },
    {
      n: 14,
      heading: 'Disclaimers and limitation of liability',
      body: [
        'To the maximum extent permitted by law, GradTools is provided without warranties of any kind, and is not liable for decisions made in reliance on figures it displays.',
        'Always confirm important academic information against your official university records.',
      ],
      legalReview: true,
    },
    {
      n: 15,
      heading: 'Changes to these Terms and contact',
      body: [
        'We may update these Terms. When we do, the version changes and you will be asked to accept the new version before continuing to use the protected parts of the application.',
        'Accepting a new version does not reset your profile or ask you to re-enter your student details.',
        'A contact address for questions about these Terms is to be provided before release.',
      ],
      legalReview: true,
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Acceptance contract                                                        */
/* -------------------------------------------------------------------------- */

/** The client POSTs the exact version it displayed; the server rejects any other. */
export const termsAcceptanceInputSchema = z.object({ version: z.string().min(1).max(40) }).strict();
export type TermsAcceptanceInput = z.infer<typeof termsAcceptanceInputSchema>;

/** A recorded acceptance: the exact version and when it was accepted. */
export const termsAcceptanceSchema = z.object({
  version: z.string(),
  acceptedAt: z.string(),
});
export type TermsAcceptance = z.infer<typeof termsAcceptanceSchema>;

export const TERMS_ROUTES = {
  /** Record the authenticated user's acceptance of the current Terms version. */
  acceptance: '/api/v1/me/terms-acceptance',
} as const;
