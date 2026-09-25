/**
 * Get VTU Result — the VTU result archive as the student would find it on
 * VTU's own site: one card per examination session, newest first, one section
 * per result type, one button per variant. Only what the catalogue carries.
 *
 * GradTools does not fetch results.vtu.ac.in or handle its CAPTCHA (docs/14).
 * A variant opens SessionDetail, which links out to VTU's page and back to the
 * importer.
 */

import {
  vtuResultCatalog,
  type VtuResultCard,
  type VtuResultSession,
} from '@gradtools/vtu-catalogue';
import { FileUp, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardRows } from '../../components/ui/card.js';
import { Input } from '../../components/ui/field.js';
import { PageHeader, Row, RowText, SectionTitle } from '../../components/ui/page.js';
import { currentSemester } from '../../domain/academics.js';
import { useAcademicState } from '../../hooks/useAcademicState.js';
import { useProfile, useResults } from '../../hooks/useCollection.js';
import { cn } from '../../lib/cn.js';
import { SessionDetail } from './SessionDetail.js';

interface Selection {
  readonly card: VtuResultCard;
  readonly session: VtuResultSession;
}

/* Per-viewer convenience only: which sessions this browser opened. */
const OPENED_KEY = 'gradtools.vtu-results.opened';

function readOpened(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(OPENED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeOpened(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(OPENED_KEY, JSON.stringify(ids));
  } catch {
    /* Storage unavailable: the list just is not remembered. */
  }
}

const variantOf = (session: VtuResultSession): string => session.variant ?? session.label;

/** Keeps a card when the query matches its title/year, or keeps its matching buttons. */
export function filterCards(
  cards: readonly VtuResultCard[],
  query: string,
): readonly VtuResultCard[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return cards;
  const hit = (text: string): boolean => terms.every((term) => text.includes(term));
  return cards.flatMap((card) => {
    const head = `${card.title} ${card.yearLabel ?? ''}`.toLowerCase();
    if (hit(head)) return [card];
    const sections = card.sections
      .map((section) => ({
        ...section,
        sessions: section.sessions.filter((session) =>
          hit(
            `${head} ${section.resultType} ${variantOf(session)} ${session.label} ${session.programme ?? ''}`.toLowerCase(),
          ),
        ),
      }))
      .filter((section) => section.sessions.length > 0);
    return sections.length > 0 ? [{ ...card, sections }] : [];
  });
}

export function GetResultPage() {
  const catalog = useMemo(() => vtuResultCatalog(), []);
  const { profile } = useProfile();
  const { items: results } = useResults();
  const { statistics } = useAcademicState();
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [opened, setOpened] = useState<string[]>(readOpened);

  const cards = filterCards(catalog.cards, query);
  const usn = profile?.usn?.trim() ? profile.usn.trim() : null;

  const markOpened = (id: string): void => {
    const next = [id, ...opened.filter((existing) => existing !== id)];
    setOpened(next);
    writeOpened(next);
  };

  const byId = new Map<string, Selection>();
  for (const card of catalog.cards)
    for (const section of card.sections)
      for (const session of section.sessions) byId.set(session.id, { card, session });

  /* `source.sessionId` is written by the importer; older records lack it. */
  const imported = (id: string): boolean =>
    results.some(
      (result) => (result as { source?: { sessionId?: unknown } }).source?.sessionId === id,
    );

  const current = currentSemester(statistics.views)?.number ?? profile?.currentSemester ?? null;
  const missing =
    current === null
      ? []
      : statistics.views.filter((view) => view.number < current && view.result === null);

  const openedSessions = opened.flatMap((id) => {
    const found = byId.get(id);
    return found === undefined ? [] : [found];
  });

  const retrieved = new Date(catalog.source.retrievedAt);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Results"
        title="Get VTU Result"
        description="Select the VTU examination session whose result you want to retrieve."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <section aria-labelledby="archive-title" className="flex min-w-0 flex-col gap-3">
          <h2 id="archive-title" className="sr-only">
            VTU result archive
          </h2>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
            />
            <Input
              type="search"
              aria-label="Filter sessions"
              placeholder="Filter by session, year, type or variant"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9.5 pl-9"
            />
          </div>

          {cards.length === 0 ? (
            <p
              role="status"
              className="rounded-xl bg-sunken px-4 py-6 text-center text-[13px] text-ink-2"
            >
              No session matches “{query}”.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {cards.map((card, index) => (
                <li key={`${String(index)}-${card.title}`}>
                  <ArchiveCard
                    card={card}
                    recent={index === 0 && query.trim() === ''}
                    onPick={(session) => setSelection({ card, session })}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="your-sessions-title">
            <SectionTitle id="your-sessions-title">Your result sessions</SectionTitle>
            {openedSessions.length === 0 ? (
              <p className="text-[13px] text-ink-3">
                Sessions you open from here are listed on this device.
              </p>
            ) : (
              <Card>
                <CardRows>
                  {openedSessions.map(({ card, session }) => {
                    const done = imported(session.id);
                    return (
                      <Row key={session.id} className="px-4">
                        <RowText
                          title={card.title}
                          meta={`${session.resultType} · ${variantOf(session)}`}
                        />
                        <Badge tone={done ? 'success' : 'warning'}>
                          {done ? 'Imported' : 'Opened — not imported yet'}
                        </Badge>
                      </Row>
                    );
                  })}
                </CardRows>
              </Card>
            )}
          </section>

          {missing.length > 0 && (
            <section aria-labelledby="missing-title">
              <SectionTitle id="missing-title">Semesters without a result</SectionTitle>
              <Card>
                <CardRows>
                  {missing.map((view) => (
                    <div key={view.number} className="flex flex-col gap-2 px-4 py-3">
                      <p className="text-[13px] text-ink-2">
                        Semester {view.number} has no result in GradTools yet.
                      </p>
                      <Button asChild size="sm" icon={<FileUp />} className="self-start">
                        <Link to={`/import?semester=${String(view.number)}`}>
                          Upload Semester {view.number} Result
                        </Link>
                      </Button>
                    </div>
                  ))}
                </CardRows>
              </Card>
            </section>
          )}
        </aside>
      </div>

      <footer className="text-[12px] leading-relaxed text-ink-3">
        Session list from {catalog.source.name}, retrieved{' '}
        {Number.isNaN(retrieved.getTime())
          ? catalog.source.retrievedAt
          : retrieved.toLocaleDateString(undefined, { dateStyle: 'medium' })}
        . Links go to results.vtu.ac.in, which GradTools does not control.
      </footer>

      <SessionDetail
        key={selection?.session.id ?? 'none'}
        selection={selection}
        usn={usn}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
        onOpened={markOpened}
      />
    </div>
  );
}

function ArchiveCard({
  card,
  recent,
  onPick,
}: {
  readonly card: VtuResultCard;
  readonly recent: boolean;
  readonly onPick: (session: VtuResultSession) => void;
}) {
  return (
    <Card className={cn('flex flex-col gap-3 p-4 sm:p-5', recent && 'ring-2 ring-accent/30')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-[15px] font-semibold text-ink">{card.title}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {recent && <Badge tone="accent">Recent</Badge>}
          {card.yearLabel !== null && <Badge>{card.yearLabel}</Badge>}
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-6">
        {card.sections.map((section) => (
          <div key={section.resultType} className="flex flex-col gap-1.5">
            <h4 className="font-mono text-[11px] tracking-[0.12em] text-ink-3 uppercase">
              {section.resultType}
            </h4>
            <div className="flex flex-wrap gap-2">
              {section.sessions.map((session) => (
                <Button
                  key={session.id}
                  variant="outline"
                  size="sm"
                  aria-label={`${card.title}, ${section.resultType}, ${session.label}${session.anomaly === null ? '' : ', Check'}`}
                  onClick={() => onPick(session)}
                  className="focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
                >
                  {session.label}
                  {session.anomaly !== null && <Badge tone="warning">Check</Badge>}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
