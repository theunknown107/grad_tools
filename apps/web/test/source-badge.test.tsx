/**
 * Source and rights presentation.
 *
 * Authority: M5 §18, §25 · docs/28
 *
 * These are honesty tests as much as UI tests. The thing they guard against is
 * a badge that shows "Source: VTU" and lets a reader conclude that GradTools
 * therefore has permission to redistribute VTU's material. Attribution is not
 * permission, and the UI must not blur them (M5 §25).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { SourceBadge } from '../src/components/SourceBadge.js';

describe('SourceBadge', () => {
  // This project does not use jest-dom, so presence is asserted by getBy*
  // throwing when absent, and cleanup is explicit between renders.
  afterEach(cleanup);

  it('always states both where it came from and what we can do with it', () => {
    render(<SourceBadge publisher="VTU" presentation="link" sourceUrl="https://example.org/x" />);
    expect(screen.getByText('Source')).toBeTruthy();
    expect(screen.getByText('VTU')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
  });

  /*
   * The core honesty requirement. Naming the publisher must never read as a
   * claim that we may redistribute their material.
   */
  it('does not imply permission when it only has attribution', () => {
    render(<SourceBadge publisher="VTU" presentation="link" sourceUrl="https://example.org/x" />);
    expect(screen.getByText(/does not host this file/i)).toBeTruthy();
    expect(screen.queryByText(/permission to provide/i)).toBeNull();
  });

  it('sends the reader to the publisher for an external document', () => {
    render(
      <SourceBadge
        publisher="VTU"
        presentation="link"
        sourceUrl="https://example.org/original.pdf"
        title="Revised timetable"
      />,
    );
    const link = screen.getByRole('link', { name: /view original/i });
    expect(link.getAttribute('href')).toBe('https://example.org/original.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    // A window opener handle must never be given to a destination we do not own.
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('names the destination for screen readers rather than relying on an icon', () => {
    render(
      <SourceBadge
        publisher="VTU"
        presentation="link"
        sourceUrl="https://example.org/x"
        title="Revised timetable"
      />,
    );
    expect(
      screen.getByRole('link', { name: /opens VTU: Revised timetable in a new tab/i }),
    ).toBeTruthy();
  });

  it('tells a student their own upload stays theirs', () => {
    render(<SourceBadge publisher="You" presentation="private" />);
    expect(screen.getByText(/private to you/i)).toBeTruthy();
    expect(screen.getByText(/never shared/i)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('offers no link for a private document even if a url is passed', () => {
    render(
      <SourceBadge publisher="You" presentation="private" sourceUrl="https://example.org/x" />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says plainly when material cannot be provided', () => {
    render(<SourceBadge publisher="Some publisher" presentation="blocked" />);
    expect(screen.getByText(/not available/i)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('claims permission only in the hosted case', () => {
    render(<SourceBadge publisher="GradTools" presentation="host" />);
    expect(screen.getByText(/has permission to provide/i)).toBeTruthy();
  });

  /*
   * M5 §18: no internal legal or operational jargon. A student should not have
   * to read our licensing position to understand what a button does.
   */
  it.each(['host', 'link', 'private', 'blocked'] as const)(
    'uses plain language for the %s state',
    (presentation) => {
      const { container } = render(
        <SourceBadge
          publisher="VTU"
          presentation={presentation}
          sourceUrl="https://example.org/x"
        />,
      );
      const text = container.textContent ?? '';
      for (const jargon of [
        'rights_status',
        'presentation',
        'UNKNOWN',
        'PROHIBITED',
        'OQ-008',
        'robots.txt',
        'redistribut',
        'quarantine',
      ]) {
        expect(text).not.toContain(jargon);
      }
    },
  );

  it('does not rely on colour alone: each state has distinct words', () => {
    const words = new Set<string>();
    for (const presentation of ['host', 'link', 'private', 'blocked'] as const) {
      const { container, unmount } = render(
        <SourceBadge publisher="VTU" presentation={presentation} sourceUrl="https://e.org/x" />,
      );
      words.add(container.textContent ?? '');
      unmount();
    }
    expect(words.size).toBe(4);
  });
});
