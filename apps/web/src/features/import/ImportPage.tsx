import { Lock, ShieldCheck } from 'lucide-react';
import { findVtuResultSession } from '@gradtools/vtu-catalogue';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui/page.js';
import { MISMATCH_SHORT } from '../vtu-results/SessionDetail.js';
import { DocumentImport, type ImportExpectation } from './DocumentImport.js';

/**
 * What the "Get VTU Result" link said this document is.
 *
 * Both are CLAIMS from a URL, checked before use: a semester outside 1–8 and a
 * session id the catalogue does not know are ignored, never shown.
 */
function expectationFrom(params: URLSearchParams): ImportExpectation {
  const rawSemester = params.get('semester') ?? '';
  const rawSession = params.get('session');
  const found = rawSession === null ? null : findVtuResultSession(rawSession);
  return {
    semester: /^[1-8]$/.test(rawSemester) ? Number(rawSemester) : null,
    session:
      found === null
        ? null
        : {
            id: found.session.id,
            label: `${found.card.title} — ${found.session.resultType} (${found.session.label})${found.session.anomaly === null ? '' : ` — ${MISMATCH_SHORT}`}`,
          },
  };
}

export function ImportPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Import"
        title="Add document"
        description="Bring in a result card, academic calendar, scheme or timetable. GradTools reads it on this device and shows you exactly what it understood before anything is saved."
      />
      <DocumentImport onDone={() => navigate('/results')} expected={expectationFrom(params)} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-3.5" aria-hidden="true" /> Your file is read on this device.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden="true" /> Only the information you confirm
          is saved.
        </span>
        <span>Supported: PDF, PNG, JPG, WebP, a result page saved as HTML · up to 20 MB</span>
      </div>
      <p className="text-[13px] text-ink-2">
        Can&apos;t import a document?{' '}
        <Link
          to="/results?new=1"
          className="font-medium text-accent-ink underline-offset-4 hover:underline"
        >
          Enter a result by hand
        </Link>
        , or{' '}
        <Link
          to="/timetable"
          className="font-medium text-accent-ink underline-offset-4 hover:underline"
        >
          add your classes manually
        </Link>
        .
      </p>
    </div>
  );
}
