/**
 * A .docx read as a DOCUMENT, not as text (class-timetable import).
 *
 * officeparser renders a Word file to plain lines, which is right for a result
 * card and destroys a timetable: the grid's cells, their horizontal and
 * vertical merges and the column geometry that ties a cell to its time slot are
 * gone before any parser sees them. This module walks `word/document.xml`
 * directly and keeps them:
 *
 *   body (in document order) → paragraphs | tables → rows → cells
 *   cell = { colStart, colEnd, rowSpan, x0, x1, paragraphs[] }
 *
 * Semantics follow python-docx (the research reference): `w:gridSpan` is a
 * horizontal merge, `w:vMerge w:val="restart"` opens a vertical merge and a bare
 * `w:vMerge` continues it, `w:gridBefore`/`w:gridAfter` skip grid columns, and
 * `w:tblGrid/w:gridCol@w:w` gives every grid column its width, so a cell's x
 * extent is exact even where a header and a body row split columns differently.
 *
 * LOCAL AND BOUNDED. Runs on the device (fflate + the platform DOMParser). A
 * document that declares a DOCTYPE/ENTITY is refused (XXE / entity expansion);
 * the XML part, compression ratio, table/row/cell counts, nesting depth and cell
 * text are all capped. Any breach returns `null` and the caller keeps the
 * existing text path — never a partial structure presented as complete.
 */

import { unzipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export const DOCX_LIMITS = {
  maxDocumentXmlBytes: 8 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxBodyChildren: 2000,
  maxTables: 40,
  maxRowsPerTable: 200,
  maxGridCols: 64,
  maxCells: 20_000,
  maxParagraphsPerCell: 64,
  maxCellText: 2000,
  maxNestingDepth: 3,
} as const;

export interface DocxCell {
  readonly row: number;
  readonly colStart: number;
  /** Inclusive. */
  readonly colEnd: number;
  /** Rows this cell covers (a vertical merge counts the continued rows). */
  rowSpan: number;
  /** Horizontal extent in twips, from the table's own grid. */
  readonly x0: number;
  readonly x1: number;
  /** One entry per paragraph, in order; never joined into one string. */
  readonly paragraphs: readonly string[];
  /** Text of tables nested inside this cell (flagged, never merged into paragraphs). */
  readonly nested: readonly string[];
}

export interface DocxTable {
  readonly index: number;
  /** Cumulative grid-column edges in twips: edges[i] .. edges[i+1] is column i. */
  readonly edges: readonly number[];
  /** Each row lists only the cells that START there; continued vertical merges grow `rowSpan`. */
  readonly rows: readonly (readonly DocxCell[])[];
}

export type DocxBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'table'; readonly table: DocxTable };

export interface DocxStructure {
  readonly blocks: readonly DocxBlock[];
}

export class DocxLimitError extends Error {}

const kids = (el: Element, local: string): Element[] =>
  Array.from(el.childNodes).filter(
    (n): n is Element =>
      n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === local,
  );
const child = (el: Element | undefined, local: string): Element | undefined =>
  el === undefined ? undefined : kids(el, local)[0];
const attr = (el: Element | undefined, local: string): string | null =>
  el === undefined ? null : (el.getAttributeNS(W, local) ?? el.getAttribute(`w:${local}`));

/** The visible text of one paragraph: runs, tabs and breaks, in order. */
function paragraphText(p: Element): string {
  let out = '';
  const walk = (node: Element) => {
    for (const n of Array.from(node.childNodes)) {
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      if (e.namespaceURI !== W) continue;
      if (e.localName === 't') out += e.textContent ?? '';
      else if (e.localName === 'tab') out += ' ';
      else if (e.localName === 'br' || e.localName === 'cr') out += ' ';
      else if (e.localName !== 'tbl') walk(e);
    }
  };
  walk(p);
  return out.replace(/\s+/g, ' ').trim();
}

function readTable(
  tbl: Element,
  index: number,
  depth: number,
  budget: { cells: number },
): DocxTable {
  const widths = kids(child(tbl, 'tblGrid') ?? tbl, 'gridCol').map((g) =>
    Math.max(0, Number(attr(g, 'w')) || 0),
  );
  if (widths.length > DOCX_LIMITS.maxGridCols) throw new DocxLimitError('too many grid columns');
  const edges = [0];
  for (const w of widths) edges.push((edges[edges.length - 1] as number) + w);
  const at = (col: number) => edges[Math.min(col, edges.length - 1)] ?? 0;

  const trs = kids(tbl, 'tr');
  if (trs.length > DOCX_LIMITS.maxRowsPerTable) throw new DocxLimitError('too many rows');
  const rows: DocxCell[][] = [];
  const open = new Map<number, DocxCell>(); // grid column -> cell whose vertical merge is still open
  trs.forEach((tr, r) => {
    const trPr = child(tr, 'trPr');
    let col = Number(attr(child(trPr, 'gridBefore'), 'val')) || 0;
    const cells: DocxCell[] = [];
    for (const tc of kids(tr, 'tc')) {
      if ((budget.cells += 1) > DOCX_LIMITS.maxCells) throw new DocxLimitError('too many cells');
      const tcPr = child(tc, 'tcPr');
      const span = Math.min(
        DOCX_LIMITS.maxGridCols,
        Math.max(1, Number(attr(child(tcPr, 'gridSpan'), 'val')) || 1),
      );
      const vm = child(tcPr, 'vMerge');
      const vmVal =
        vm === undefined ? null : attr(vm, 'val') === 'restart' ? 'restart' : 'continue';
      if (vmVal === 'continue' && open.has(col)) {
        (open.get(col) as DocxCell).rowSpan += 1;
        col += span;
        continue;
      }
      const paras = kids(tc, 'p').slice(0, DOCX_LIMITS.maxParagraphsPerCell).map(paragraphText);
      let total = 0;
      const paragraphs = paras
        .filter((t) => t !== '')
        .map((t) => {
          const room = Math.max(0, DOCX_LIMITS.maxCellText - total);
          total += t.length;
          return t.slice(0, room);
        });
      const nestedTables = kids(tc, 'tbl');
      if (nestedTables.length > 0 && depth + 1 > DOCX_LIMITS.maxNestingDepth)
        throw new DocxLimitError('tables nested too deeply');
      const nested = nestedTables.map((t) =>
        readTable(t, -1, depth + 1, budget)
          .rows.flat()
          .flatMap((c) => c.paragraphs)
          .join(' '),
      );
      const cell: DocxCell = {
        row: r,
        colStart: col,
        colEnd: col + span - 1,
        rowSpan: 1,
        x0: at(col),
        x1: at(col + span),
        paragraphs,
        nested,
      };
      for (let c = col; c < col + span; c += 1) open.delete(c);
      if (vmVal === 'restart') open.set(col, cell);
      cells.push(cell);
      col += span;
    }
    // a column that this row filled without a continuation closes any merge there
    rows.push(cells);
  });
  return { index, edges, rows };
}

/**
 * The structure of a .docx, or null when it is not one, breaches a limit, or
 * carries a DOCTYPE. Null means "use the existing text path", never an error.
 */
export function readDocxStructure(bytes: Uint8Array): DocxStructure | null {
  let xml: string;
  try {
    let compressed = 0;
    const files = unzipSync(bytes, {
      filter: (f) => {
        if (f.name !== 'word/document.xml') return false;
        compressed = f.size;
        if (f.originalSize > DOCX_LIMITS.maxDocumentXmlBytes)
          throw new DocxLimitError('document part too large');
        if (f.size > 0 && f.originalSize / f.size > DOCX_LIMITS.maxCompressionRatio)
          throw new DocxLimitError('compression ratio too high');
        return true;
      },
    });
    const part = files['word/document.xml'];
    if (part === undefined || compressed < 0) return null;
    xml = new TextDecoder('utf-8').decode(part);
  } catch {
    return null;
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (body === undefined) return null;
  try {
    const children = Array.from(body.childNodes).filter((n): n is Element => n.nodeType === 1);
    if (children.length > DOCX_LIMITS.maxBodyChildren) return null;
    const blocks: DocxBlock[] = [];
    const budget = { cells: 0 };
    let tables = 0;
    for (const el of children) {
      if (el.namespaceURI !== W) continue;
      if (el.localName === 'p') blocks.push({ kind: 'paragraph', text: paragraphText(el) });
      else if (el.localName === 'tbl') {
        if ((tables += 1) > DOCX_LIMITS.maxTables) return null;
        blocks.push({ kind: 'table', table: readTable(el, tables - 1, 1, budget) });
      }
    }
    return { blocks };
  } catch (cause) {
    if (cause instanceof DocxLimitError) return null;
    throw cause;
  }
}
