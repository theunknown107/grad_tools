/**
 * SYNTHETIC announcements fixture.
 *
 * Authority: M5 §13, §21
 *
 * Handwritten HTML in the shape of a WordPress notices list. It is NOT a
 * capture of vtu.ac.in and reproduces none of its content: the titles below are
 * invented, and the source has never been fetched (see vtu-announcements.ts).
 *
 * It exists so parse/normalize/validate can be golden-tested with no network
 * and no dependence on the real page being up or unchanged.
 */

export const ANNOUNCEMENTS_FIXTURE = `
<html><body>
  <ul class="notices">
    <li class="notice-item">
      <a href="/notice/example-timetable-revision/">Revised examination timetable &amp; venue list</a>
      <span class="date">2026-07-10</span>
    </li>
    <li class="notice-item">
      <a href="https://example.org/external-circular.pdf">Circular regarding <b>attendance</b> condonation</a>
      <span class="date">2026-07-02</span>
    </li>
    <li class="notice-item">
      <a href="/notice/example-no-date/">Notice with no date supplied</a>
    </li>
  </ul>
  <ul class="unrelated"><li><a href="/nav/home/">Home</a></li></ul>
</body></html>
`;

/** The same list with one title changed and one item gone, for change detection. */
export const ANNOUNCEMENTS_FIXTURE_UPDATED = `
<html><body>
  <ul class="notices">
    <li class="notice-item">
      <a href="/notice/example-timetable-revision/">Revised examination timetable (version 2)</a>
      <span class="date">2026-07-12</span>
    </li>
    <li class="notice-item">
      <a href="/notice/example-new-item/">A newly posted notice</a>
      <span class="date">2026-07-15</span>
    </li>
    <li class="notice-item">
      <a href="/notice/example-no-date/">Notice with no date supplied</a>
    </li>
  </ul>
</body></html>
`;

/** Hostile shapes an adapter must refuse rather than pass along. */
export const ANNOUNCEMENTS_FIXTURE_HOSTILE = `
<html><body>
  <ul class="notices">
    <li class="notice-item"><a href="javascript:alert(1)">Script link</a></li>
    <li class="notice-item"><a href="/notice/empty-title/"></a></li>
    <li class="notice-item"><a href="/notice/dupe/">First</a></li>
    <li class="notice-item"><a href="/notice/dupe/">Second with the same id</a></li>
  </ul>
</body></html>
`;
