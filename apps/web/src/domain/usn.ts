/**
 * What a VTU University Seat Number says about its student.
 *
 * A USN such as `1XX22CS001` is: region digit, college code (`XX`), admission
 * year (`22`), branch code (`CS`), roll number. Used only ON THE DEVICE, to
 * fill in the college, branch and semester for notice relevance when the
 * profile leaves them blank; nothing here is sent anywhere.
 */

export interface UsnParts {
  readonly collegeCode: string;
  readonly admissionYear: number;
  readonly branchCode: string;
}

const USN = /^\s*[1-4]([A-Z]{2})(\d{2})([A-Z]{2,3})\d{3}\s*$/i;

export function parseUsn(usn: string | null | undefined): UsnParts | null {
  const match = USN.exec(usn ?? '');
  if (match === null) return null;
  const [, college = '', year = '', branch = ''] = match;
  return {
    collegeCode: college.toUpperCase(),
    admissionYear: 2000 + Number(year),
    branchCode: branch.toUpperCase(),
  };
}

/** Common VTU USN branch codes. An unknown code yields null, never a guess. */
const BRANCH_BY_CODE: Readonly<Record<string, string>> = {
  CS: 'Computer Science and Engineering',
  IS: 'Information Science and Engineering',
  EC: 'Electronics and Communication Engineering',
  EE: 'Electrical and Electronics Engineering',
  ME: 'Mechanical Engineering',
  CV: 'Civil Engineering',
  CB: 'Computer Science and Business Systems',
  AI: 'Artificial Intelligence and Machine Learning',
  AD: 'Artificial Intelligence and Data Science',
  CD: 'Computer Science and Engineering (Data Science)',
  CY: 'Computer Science and Engineering (Cyber Security)',
  CG: 'Computer Science and Design',
  ET: 'Electronics and Telecommunication Engineering',
  EI: 'Electronics and Instrumentation Engineering',
  ML: 'Medical Electronics Engineering',
  BT: 'Biotechnology',
  CH: 'Chemical Engineering',
  AE: 'Aeronautical Engineering',
  AU: 'Automobile Engineering',
};

export function branchNameForCode(code: string): string | null {
  return BRANCH_BY_CODE[code.toUpperCase()] ?? null;
}

/**
 * The semester a regular-entry student admitted in `admissionYear` is in on
 * `now`: VTU's odd semester starts around August. Null outside 1–8.
 */
export function semesterFromAdmission(admissionYear: number, now: Date): number | null {
  const months = (now.getFullYear() - admissionYear) * 12 + (now.getMonth() - 7);
  if (months < 0) return null;
  const semester = Math.floor(months / 6) + 1;
  return semester >= 1 && semester <= 8 ? semester : null;
}
