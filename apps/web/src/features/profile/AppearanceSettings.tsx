/**
 * Themes (More → Themes) — the design's Theme, Palette, Interface and Preview
 * cards, plus the glass level.
 *
 * Light / Dark / System, one of eighteen palettes in three groups (Mono by
 * default; docs/51_THEMES.md), glass (Clear, Regular, Frosted or Solid —
 * Solid is reduced transparency), density and reduced motion. Device-local only: never synced, and nothing here can reach an
 * academic figure — the palette recolours interactive states, never grades,
 * credits or GPA.
 */

import { Check, Monitor, Moon, Rows3, Rows4, Sun, GraduationCap, CalendarDays } from 'lucide-react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { useState } from 'react';
import { useTheme } from '../../hooks/useTheme.js';
import { cn } from '../../lib/cn.js';
import {
  ACCENTS,
  ACCENT_GROUPS,
  ACCENT_INFO,
  accentName,
  type Appearance,
  type Density,
  type Glass,
} from '../../lib/theme.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { toast } from '../../components/ui/feedback.js';
import { Input, Switch } from '../../components/ui/field.js';
import { SectionTitle } from '../../components/ui/page.js';
import { Segmented } from '../../components/ui/segmented.js';

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
  const { preference, resolved, setAppearance, setAccent, setDensity, setReducedMotion, setGlass } =
    useTheme();

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6" aria-labelledby="appearance-theme">
        <SectionTitle id="appearance-theme">Theme</SectionTitle>
        <p className="mb-4 text-[13px] text-ink-2">
          System is <span className="font-medium text-ink capitalize">{resolved}</span> now.
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
        <SectionTitle id="appearance-accent">Palette</SectionTitle>
        {/* One radiogroup across the three groups: one tab stop, arrow keys move through all. */}
        <RadioGroup.Root
          aria-labelledby="appearance-accent"
          value={preference.accent}
          onValueChange={(value) => {
            const key = ACCENTS.find((entry) => entry === value);
            if (key === undefined) return;
            setAccent(key);
            toast(`Palette set to ${accentName(key)}`, { tone: 'accent' });
          }}
          className="flex flex-col gap-4"
        >
          {ACCENT_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-ink-3">{group.label}</span>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] gap-2.5 sm:flex sm:flex-wrap">
                {ACCENTS.filter((key) => ACCENT_INFO[key].group === group.id).map((key) => {
                  const info = ACCENT_INFO[key];
                  const active = preference.accent === key;
                  return (
                    <RadioGroup.Item
                      key={key}
                      value={key}
                      aria-label={accentName(key)}
                      className={cn(
                        'flex min-h-11 flex-col items-center gap-2 rounded-xl border p-3 text-center transition-[border-color,box-shadow] duration-150 sm:w-[5.25rem]',
                        active
                          ? 'border-accent bg-accent-weak/40 ring-2 ring-accent/20'
                          : 'border-line hover:border-line-strong',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="grid size-8 place-items-center rounded-full ring-1 ring-black/5"
                        style={{ background: resolved === 'dark' ? info.dark : info.light }}
                      >
                        {active && (
                          <Check
                            className="size-4 text-white mix-blend-difference"
                            strokeWidth={3}
                          />
                        )}
                      </span>
                      <span className="text-[12px] leading-tight font-medium">{info.label}</span>
                    </RadioGroup.Item>
                  );
                })}
              </div>
            </div>
          ))}
        </RadioGroup.Root>
      </Card>

      <Card className="p-6">
        <SectionTitle>Interface</SectionTitle>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[13px] font-medium">Glass</div>
            <Segmented<Glass | 'solid'>
              label="Glass"
              value={preference.reducedTransparency ? 'solid' : preference.glass}
              onChange={setGlass}
              options={[
                { value: 'clear', label: 'Clear' },
                { value: 'regular', label: 'Regular' },
                { value: 'frosted', label: 'Frosted' },
                { value: 'solid', label: 'Solid' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[13px] font-medium">Density</div>
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
