/**
 * Account → Settings → Appearance — the design's Theme, Accent, Interface and Preview
 * cards.
 *
 * Light / Dark / System, one of twelve accents (Mono by default), density and
 * reduced motion. Device-local only: never synced, and nothing here can reach
 * an academic figure — the accent recolours interactive states, never grades,
 * credits or GPA.
 */

import { Check, Monitor, Moon, Rows3, Rows4, Sun, GraduationCap, CalendarDays } from 'lucide-react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { useState } from 'react';
import { useTheme } from '../../hooks/useTheme.js';
import { cn } from '../../lib/cn.js';
import { ACCENTS, type Accent, type Appearance, type Density } from '../../lib/theme.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { toast } from '../../components/ui/feedback.js';
import { Input, Switch } from '../../components/ui/field.js';
import { SectionTitle } from '../../components/ui/page.js';
import { Segmented } from '../../components/ui/segmented.js';

/** Swatch colours, the same values the stylesheet uses for each accent. */
const SWATCH: Record<Accent, { label: string; light: string; dark: string }> = {
  mono: { label: 'Mono', light: '#1b1a17', dark: '#f4f3f1' },
  violet: { label: 'Violet', light: '#5b4cc4', dark: '#8f80f0' },
  matrix: { label: 'Matrix', light: '#2a7147', dark: '#4bbd7f' },
  crimson: { label: 'Crimson', light: '#c8102e', dark: '#f04d63' },
  turquoise: { label: 'Turquoise', light: '#0a7580', dark: '#35c2cf' },
  ocean: { label: 'Ocean', light: '#2b6cb0', dark: '#5ea1e6' },
  amber: { label: 'Amber', light: '#8f5d12', dark: '#e0a848' },
  rose: { label: 'Rose', light: '#be2f65', dark: '#f0709b' },
  indigo: { label: 'Indigo', light: '#4338ca', dark: '#818cf8' },
  emerald: { label: 'Emerald', light: '#047857', dark: '#34d399' },
  solar: { label: 'Solar', light: '#a14a08', dark: '#f0932e' },
  slate: { label: 'Slate', light: '#475569', dark: '#94a3b8' },
};

const THEME_OPTIONS: readonly {
  value: Appearance;
  label: string;
  Icon: typeof Sun;
  swatch: string;
}[] = [
  {
    value: 'light',
    label: 'Light',
    Icon: Sun,
    swatch: 'border border-[#e3dfd7] bg-white text-[#1b1a17]',
  },
  {
    value: 'dark',
    label: 'Dark',
    Icon: Moon,
    swatch: 'border border-white/10 bg-[#0e0e11] text-white',
  },
  {
    value: 'system',
    label: 'System',
    Icon: Monitor,
    swatch: 'border border-line bg-linear-to-br from-white via-white to-[#0e0e11] text-ink',
  },
];

export function AppearanceSettings() {
  const { preference, resolved, setAppearance, setAccent, setDensity, setReducedMotion } =
    useTheme();

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6" aria-labelledby="appearance-theme">
        <SectionTitle id="appearance-theme">Theme</SectionTitle>
        <p className="mb-4 text-[13px] text-ink-2">
          Choose how GradTools looks. System follows your device — currently{' '}
          <span className="font-medium text-ink capitalize">{resolved}</span>. The sun/moon button
          in the top bar flips between light and dark at any time.
        </p>
        {/* Radix supplies the radiogroup pattern: one tab stop, arrow keys move and select. */}
        <RadioGroup.Root
          aria-labelledby="appearance-theme"
          value={preference.appearance}
          onValueChange={(value) => {
            const option = THEME_OPTIONS.find((entry) => entry.value === value);
            if (option === undefined) return;
            setAppearance(option.value);
            toast(`${option.label} theme applied`, { tone: 'accent' });
          }}
          className="grid grid-cols-3 gap-3"
        >
          {THEME_OPTIONS.map((option) => {
            const active = preference.appearance === option.value;
            return (
              <RadioGroup.Item
                key={option.value}
                value={option.value}
                className={cn(
                  'relative flex flex-col items-center gap-2 rounded-xl border p-4 transition-[border-color,box-shadow,background] duration-150',
                  active
                    ? 'bg-accent-weak/40 ring-2 ring-accent/20'
                    : 'border-line hover:border-line-strong',
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-2 right-2 grid size-4 place-items-center rounded-full bg-accent text-on-accent"
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className={cn('grid size-11 place-items-center rounded-lg', option.swatch)}
                >
                  <option.Icon className="size-5" />
                </span>
                <span className="text-[13px] font-medium">{option.label}</span>
              </RadioGroup.Item>
            );
          })}
        </RadioGroup.Root>
      </Card>

      <Card className="p-6" aria-labelledby="appearance-accent">
        <SectionTitle id="appearance-accent">Accent</SectionTitle>
        <p className="mb-4 text-[13px] text-ink-2">
          The accent colours interactive states — buttons, links, selection and focus. Mono (black
          and white) is the default. Surfaces stay neutral in every accent, and no academic figure
          ever changes colour because of it.
        </p>
        <RadioGroup.Root
          aria-labelledby="appearance-accent"
          value={preference.accent}
          onValueChange={(value) => {
            const key = ACCENTS.find((entry) => entry === value);
            if (key === undefined) return;
            setAccent(key);
            toast(`Accent set to ${SWATCH[key].label}`, { tone: 'accent' });
          }}
          className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-2.5 sm:flex sm:flex-wrap"
        >
          {ACCENTS.map((key) => {
            const swatch = SWATCH[key];
            const active = preference.accent === key;
            return (
              <RadioGroup.Item
                key={key}
                value={key}
                className={cn(
                  'flex flex-col items-center gap-2 rounded-xl border p-3 transition-[border-color,box-shadow] duration-150 sm:w-[5.25rem]',
                  active ? 'ring-2 ring-accent/20' : 'border-line hover:border-line-strong',
                )}
              >
                <span
                  aria-hidden="true"
                  className="grid size-8 place-items-center rounded-full ring-1 ring-black/5"
                  style={{ background: resolved === 'dark' ? swatch.dark : swatch.light }}
                >
                  {active && (
                    <Check className="size-4 text-white mix-blend-difference" strokeWidth={3} />
                  )}
                </span>
                <span className="text-[12px] font-medium">{swatch.label}</span>
              </RadioGroup.Item>
            );
          })}
        </RadioGroup.Root>
      </Card>

      <Card className="p-6">
        <SectionTitle>Interface</SectionTitle>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[13px] font-medium">Density</div>
              <div className="text-[12px] text-ink-3">
                Comfortable spacing, or compact to fit more on screen.
              </div>
            </div>
            <Segmented<Density>
              label="Density"
              value={preference.density}
              onChange={(density) => {
                setDensity(density);
                toast(`${density === 'compact' ? 'Compact' : 'Comfortable'} density`);
              }}
              options={[
                {
                  value: 'comfortable',
                  label: (
                    <>
                      <Rows3 aria-hidden="true" />
                      Comfortable
                    </>
                  ),
                },
                {
                  value: 'compact',
                  label: (
                    <>
                      <Rows4 aria-hidden="true" />
                      Compact
                    </>
                  ),
                },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
            <div>
              <label htmlFor="reduced-motion" className="text-[13px] font-medium">
                Reduced motion
              </label>
              <div className="text-[12px] text-ink-3">
                Minimise animations and transitions. Your device&apos;s own reduced-motion setting
                is always honoured too.
              </div>
            </div>
            <Switch
              id="reduced-motion"
              checked={preference.reducedMotion}
              onCheckedChange={setReducedMotion}
            />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <SectionTitle>Preview</SectionTitle>
        <p className="mb-4 text-[13px] text-ink-2">
          A live sample of the current theme, accent and density.
        </p>
        <AppearancePreview />
      </Card>
    </div>
  );
}

function AppearancePreview() {
  const [tab, setTab] = useState<'overview' | 'detail'>('overview');
  return (
    <div aria-hidden="true" inert className="rounded-xl border border-line bg-canvas p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Semester 5</Badge>
        <Badge tone="success">No backlogs</Badge>
        <Badge tone="warning">2 at risk</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel p-2">
          <div className="flex items-center gap-2.5 rounded-lg bg-accent-weak px-3 py-2 text-[13px] font-medium text-accent-ink">
            <GraduationCap className="size-4" /> Selected item
          </div>
          <div className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-ink-2">
            <CalendarDays className="size-4 text-ink-3" /> Inactive item
          </div>
        </div>
        <div className="gt-metric rounded-lg p-3">
          <div className="text-[11px] font-medium text-ink-2">Sample figure</div>
          <div className="tnum text-2xl font-semibold tracking-[-0.02em]">8.00</div>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        <Segmented
          label="Preview tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'detail', label: 'Detail' },
          ]}
          className="self-start"
        />
        <Input placeholder="Search results, courses…" tabIndex={-1} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="glass-primary" tabIndex={-1}>
            Primary action
          </Button>
          <Button variant="glass" tabIndex={-1}>
            Glass control
          </Button>
          <Button tabIndex={-1}>Secondary</Button>
          <Button variant="ghost" tabIndex={-1}>
            Ghost
          </Button>
        </div>
      </div>
    </div>
  );
}
