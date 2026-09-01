/**
 * A form split into named sections, with a rail.
 *
 * Authority: docs/05 §5.27 (M9.6F) · docs/27 §27.3
 * Reference: 21st.dev @cnippet.dev/v-form-8 — RECREATED. The source was not
 * retrievable (docs/05 §5.22); the accessible evidence was its preview, its
 * described structure — a multi-step wizard with account details, selection,
 * review and confirmation — and its dependency list.
 *
 * ---------------------------------------------------------------------------
 * A WIZARD IS THE WRONG SHAPE FOR SETTINGS, AND THAT IS THE ADAPTATION
 * ---------------------------------------------------------------------------
 *
 * The reference is an ONBOARDING wizard: ordered steps, each gating the next,
 * ending in a submit. That shape is right when a task has a beginning and an
 * end and the person must finish it.
 *
 * GradTools' settings are the opposite. Appearance, privacy, sync and deletion
 * are independent, unordered, and each saves on its own; nobody "completes"
 * their account page. Forcing them into steps would invent a sequence and
 * imply that reaching the end matters.
 *
 * So what is taken is the reference's real contribution — a long form broken
 * into named sections with persistent navigation between them, so one screen
 * shows one concern instead of a wall of controls. What is dropped is the
 * ordering, the progress indicator and the terminal submit.
 *
 * ---------------------------------------------------------------------------
 * IT IS NAVIGATION, NOT TABS
 * ---------------------------------------------------------------------------
 *
 * The rail is a `nav` of links to headings, NOT a tablist. Each section is a
 * real `<section>` with a heading that exists in the document whichever one is
 * showing, so the page keeps a coherent outline for a screen reader and
 * Ctrl-F still finds a setting the person is not currently looking at. Tabs
 * would hide the other sections from both.
 */

import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons.js';
import styles from './SectionedForm.module.css';

export interface FormSection {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Marked out as destructive, and always placed last. */
  readonly tone?: 'default' | 'danger';
  readonly children: ReactNode;
}

export function SectionedForm({
  label,
  sections,
}: {
  readonly label: string;
  readonly sections: readonly FormSection[];
}): ReactNode {
  const [active, setActive] = useState(sections[0]?.id ?? '');
  const current = sections.find((section) => section.id === active) ?? sections[0];

  return (
    <div className={styles.wrap}>
      <nav className={styles.rail} aria-label={label}>
        <ul>
          {sections.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                className={styles.railItem}
                data-active={section.id === active}
                data-tone={section.tone ?? 'default'}
                // aria-current, not aria-selected: this is navigation within a
                // page, and aria-selected outside a tablist means nothing.
                aria-current={section.id === active ? 'true' : undefined}
                onClick={() => setActive(section.id)}
              >
                {section.icon !== undefined ? <Icon name={section.icon} size="nav" /> : null}
                <span>{section.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className={styles.body}>
        {current === undefined ? null : (
          <section aria-labelledby={`section-${current.id}`} className={styles.section}>
            <h2 className={styles.sectionTitle} id={`section-${current.id}`}>
              {current.label}
            </h2>
            {current.children}
          </section>
        )}
      </div>
    </div>
  );
}
