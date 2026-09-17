import { ArrowLeft, Compass, LayoutDashboard, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useOpenCommand } from '../components/navigation/CommandMenu.js';
import { Button } from '../components/ui/button.js';

export function NotFoundPage() {
  const navigate = useNavigate();
  const openCommand = useOpenCommand();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="relative mb-6" aria-hidden="true">
        <div className="grid size-20 place-items-center rounded-2xl bg-accent-weak text-accent-ink">
          <Compass className="size-9" />
        </div>
        <span className="absolute -top-2 -right-2 rotate-6 font-mono text-[11px] font-semibold text-ink-3">
          404
        </span>
      </div>
      <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">
        This page isn&apos;t in your record
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-2">
        The route you followed doesn&apos;t exist in GradTools. It may have moved, or the link was
        mistyped.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button asChild variant="primary" icon={<LayoutDashboard />}>
          <Link to="/">Go to dashboard</Link>
        </Button>
        <Button icon={<Search />} onClick={openCommand}>
          Search
        </Button>
        <Button variant="ghost" icon={<ArrowLeft />} onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
    </div>
  );
}
