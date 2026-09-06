/**
 * A sortable, filterable table.
 *
 * Authority: Phase 7B §2, §12 · docs/27 §27.7
 * Provenance: behaviourally faithful shadcn implementation adapted to the
 * GradTools styling architecture. shadcn's Data Table is
 * `@tanstack/react-table` driving its Table markup, and so is this one — the
 * library is headless and ships no styling at all, so there was nothing
 * Tailwind to replace, only markup to write in GradTools' own table classes.
 *
 * ---------------------------------------------------------------------------
 * IT IS A REAL <table>
 * ---------------------------------------------------------------------------
 *
 * Every row is a `<tr>`, every cell a `<td>`, every header a `<th scope="col">`
 * with `aria-sort`. A grid of divs with `role="table"` bolted on is the usual
 * shape of this component and it is worse in every way that matters: screen
 * readers announce a real table's dimensions, let a person navigate it by cell,
 * and read the column header with each value. None of that survives the
 * translation to divs.
 *
 * The sort control is a `<button>` INSIDE the `<th>`, not the `<th>` itself,
 * because a `<th>` with a click handler is not focusable and not announced as
 * actionable.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS BELONGS, AND WHERE IT DOES NOT
 * ---------------------------------------------------------------------------
 *
 * Eight subjects in a semester do not need sorting; they have a natural order
 * and a plain `<table>` says so. This is for the tables where a student is
 * genuinely looking for something — every subject across every semester,
 * attendance across a term — and where "show me the lowest first" is the
 * question being asked.
 *
 * There is no pagination here. Pagination is DEFER in the coverage matrix
 * because no GradTools dataset is large enough to need it, and adding controls
 * for a page that is always page one is chrome.
 */

import { useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { Icon } from '../icons.js';
import { TableScroll, tableClass } from './index.js';
import styles from './DataTable.module.css';

export type { ColumnDef };

export function DataTable<TRow>({
  data,
  columns,
  caption,
  filter,
  empty = 'Nothing to show.',
  initialSort,
}: {
  readonly data: readonly TRow[];
  readonly columns: readonly ColumnDef<TRow, never>[];
  /**
   * What the table is, in a sentence. Rendered as a real `<caption>`: it is the
   * table's accessible name, and a table announced only as "table with 9 rows"
   * tells a screen-reader user nothing about which table they are in.
   */
  readonly caption: string;
  /** Free-text filter applied across every column. */
  readonly filter?: string | undefined;
  readonly empty?: ReactNode;
  readonly initialSort?: SortingState | undefined;
}): ReactNode {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);

  const table = useReactTable({
    data: data as TRow[],
    columns: columns as ColumnDef<TRow, unknown>[],
    state: { sorting, globalFilter: filter ?? '' },
    onSortingChange: setSorting,
    /*
     * FIRST CLICK IS ALWAYS ASCENDING.
     *
     * TanStack's default flips this per column TYPE — a numeric column sorts
     * descending first, a string column ascending — so clicking "Code" and
     * clicking "Total" behave differently for no reason a student could infer.
     * One direction for every column is the predictable one.
     */
    sortDescFirst: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;

  return (
    <TableScroll>
      <table className={`${tableClass} ${styles.table ?? ''}`}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const direction = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    /*
                     * `aria-sort` goes on the HEADER CELL, not the button, and
                     * only on the column that is actually sorted. Marking every
                     * sortable column `none` is legal but noisy; the omission is
                     * what "not sorted" means.
                     */
                    aria-sort={
                      direction === 'asc'
                        ? 'ascending'
                        : direction === 'desc'
                          ? 'descending'
                          : undefined
                    }
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        {/*
                          The arrow appears only on the sorted column. A dimmed
                          arrow on all of them makes the one that means
                          something impossible to find at a glance, and
                          `aria-sort` already carries the state for anyone not
                          reading the glyph.
                        */}
                        {direction !== false && (
                          <Icon
                            name="chevronDown"
                            size="micro"
                            className={direction === 'asc' ? styles.sortUp : styles.sortDown}
                          />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className={styles.empty} colSpan={table.getAllLeafColumns().length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TableScroll>
  );
}
