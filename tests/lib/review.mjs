/**
 * Driving the import's REVIEW step.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * The review step used to print every parsed course as an open form: a row of
 * labelled fields per subject, all on screen at once. The current design draws
 * each course as a COLLAPSED row you press to open — the same disclosure the
 * saved-result table uses — so `Credits 3` does not exist in the document until
 * row three has been opened.
 *
 * Three harnesses filled those fields directly and all three began timing out
 * waiting for a label that was never going to appear. Waiting longer would
 * never have helped; the row has to be opened first.
 *
 * Kept here rather than copied into each harness, so the next change to the
 * review step is one edit and not three divergent ones.
 */

/**
 * Opens the review row at `index` (1-based) if it is not already open.
 *
 * Returns nothing and asserts nothing: the caller's own assertions about the
 * fields are what prove the row opened, and a helper that threw its own errors
 * would report them as the harness's rather than the step's.
 */
export async function openReviewRow(page, index) {
  /*
   * Scoped to `#main`. The shell's own disclosures — the sidebar rail toggle
   * among them — also carry `aria-expanded`, and an unscoped nth() picks one
   * of those and opens the sidebar instead of a course.
   */
  const row = page.locator('#main button[aria-expanded]').nth(index - 1);
  if ((await row.count()) === 0) return;
  if ((await row.getAttribute('aria-expanded')) === 'true') return;
  await row.scrollIntoViewIfNeeded();
  await row.click();
  /* The fields are rendered by the same commit that flips the attribute, so
     waiting for the row to report itself open is waiting for its fields. */
  await row.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  await page
    .waitForFunction(
      (n) => document.querySelectorAll('#main button[aria-expanded="true"]').length >= n,
      1,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
}

/**
 * Opens a row and returns its labelled field, ready to fill.
 *
 * `label` is the field's visible label without its row number — "Credits",
 * "Grade", "Internal" — which is how the step names them.
 */
export async function reviewField(page, label, index) {
  const field = page.getByLabel(new RegExp(`^${label} ${String(index)}$`, 'i')).first();
  /*
   * Only open a row when the field is genuinely absent.
   *
   * The saved-result EDITOR reached from a semester's actions menu shows the
   * same labelled fields without any disclosure, so expanding there pressed
   * whatever happened to be the first `aria-expanded` control on the page and
   * changed something nobody asked it to. Opening is the fallback, not the
   * first move.
   */
  if ((await field.count()) > 0) return field;
  await openReviewRow(page, index);
  return page.getByLabel(new RegExp(`^${label} ${String(index)}$`, 'i')).first();
}
