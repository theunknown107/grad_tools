import { Lock, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/ui/page.js';
import { DocumentImport } from './DocumentImport.js';

export function ImportPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Import"
        title="Add document"
        description="Bring in a result card, academic calendar, scheme or timetable. GradTools reads it on this device and shows you exactly what it understood before anything is saved."
      />
      <DocumentImport onDone={() => navigate('/results')} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-3.5" aria-hidden="true" /> Your file is read on this device.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden="true" /> Only the information you confirm
          is saved.
        </span>
        <span>Supported: PDF, PNG, JPG, WebP · up to 20 MB</span>
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
