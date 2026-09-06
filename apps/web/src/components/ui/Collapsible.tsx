/**
 * A single disclosure.
 *
 * Authority: Phase 7B §2, §12
 * Provenance: behaviourally faithful shadcn/Radix implementation adapted to the
 * GradTools styling architecture. The behaviour is
 * `@radix-ui/react-collapsible`.
 *
 * ---------------------------------------------------------------------------
 * COLLAPSIBLE, NOT ACCORDION
 * ---------------------------------------------------------------------------
 *
 * An accordion is a SET of sections that know about each other. A collapsible
 * is one thing that opens. "Add a class" is a collapsible; a week of six days
 * is an accordion. Using the accordion for a lone section leaves a group of one
 * in the accessibility tree, which is a group that does not exist.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `<details>`
 * ---------------------------------------------------------------------------
 *
 * `<details>` is genuinely good and GradTools uses it — `ExplanationDisclosure`
 * is a `<details>` and stays one, because it needs no animation and no external
 * control. Two things push a disclosure off it:
 *
 *   - it cannot be animated open. `<details>` toggles `display`, so there is no
 *     height to transition, and the workarounds all involve fighting the
 *     element,
 *   - its open state cannot be driven from outside without imperative DOM,
 *     which the import flow needs (a failed parse should open the manual entry
 *     it suggests).
 *
 * Where neither applies, `<details>` is still the right answer and this
 * component is the heavier choice.
 */

import type { ReactNode } from 'react';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { Icon, type IconName } from '../icons.js';
import styles from './Collapsible.module.css';

export function Collapsible({
  summary,
  icon,
  children,
  open,
  onOpenChange,
  defaultOpen = false,
}: {
  readonly summary: string;
  readonly icon?: IconName | undefined;
  readonly children: ReactNode;
  /** Controlled. Omit both to let the component own its own state. */
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly defaultOpen?: boolean;
}): ReactNode {
  return (
    <CollapsiblePrimitive.Root
      className={styles.root}
      /*
       * Radix treats a defined `open` as controlled, so an `open={undefined}`
       * spread would not be enough — the props are split rather than merged so
       * an uncontrolled caller never accidentally pins the state to `false`.
       */
      {...(open === undefined
        ? { defaultOpen }
        : { open, ...(onOpenChange === undefined ? {} : { onOpenChange }) })}
    >
      <CollapsiblePrimitive.Trigger className={styles.trigger}>
        {icon !== undefined && <Icon name={icon} size="nav" />}
        <span className={styles.summary}>{summary}</span>
        <Icon name="chevronDown" size="nav" className={styles.chevron} />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className={styles.content}>
        <div className={styles.body}>{children}</div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
