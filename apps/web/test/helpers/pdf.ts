/** Synthetic PDFs with a text layer, for tests. Every value placed in one is invented. */

/** One `Td`/`Tj` pair: place the pen, draw the text. */
export interface Placed {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly size?: number;
}

/**
 * A minimal, uncompressed, standards-conforming PDF.
 *
 * Uncompressed on purpose: the bytes stay greppable, so a failing test can be
 * diagnosed by reading the fixture rather than by decoding it.
 */
export function makePdf(
  pages: readonly (readonly Placed[])[],
  { width = 612, height = 792 }: { readonly width?: number; readonly height?: number } = {},
): ArrayBuffer {
  const escape = (text: string) => text.replace(/([\\()])/g, '\\$1');

  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 = catalogue, 2 = page tree, 3 = font; pages and streams follow.
  let next = 4;

  const streams: string[] = [];
  for (const placed of pages) {
    const content =
      'BT\n' +
      placed
        .map(
          (item) =>
            `/F1 ${String(item.size ?? 10)} Tf\n1 0 0 1 ${String(item.x)} ${String(item.y)} Tm\n(${escape(item.text)}) Tj`,
        )
        .join('\n') +
      '\nET';
    const streamId = next++;
    const pageId = next++;
    pageIds.push(pageId);
    streams.push(
      `${String(streamId)} 0 obj\n<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream\nendobj\n`,
    );
    objects.push(
      `${String(pageId)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(width)} ${String(height)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(streamId)} 0 R >>\nendobj\n`,
    );
  }

  const body = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pageIds.length)} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ...streams,
    ...objects,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of body) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xref = pdf.length;
  const count = body.length + 1;

  pdf += `xref\n0 ${String(count)}\n0000000000 65535 f \n`;
  /*
   * Objects are emitted in the order above, and each xref entry must sit at the
   * index of ITS object number — so the table is filled by number, not by
   * emission order.
   */
  const byNumber = new Map<number, number>();
  body.forEach((object, index) => {
    const number = Number(/^(\d+) 0 obj/.exec(object)?.[1] ?? '0');
    byNumber.set(number, offsets[index] as number);
  });
  for (let number = 1; number < count; number += 1) {
    pdf += `${String(byNumber.get(number) ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${String(count)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF`;

  return new TextEncoder().encode(pdf).buffer as ArrayBuffer;
}
