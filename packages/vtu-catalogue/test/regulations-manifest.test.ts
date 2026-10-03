/**
 * Source-manifest validation for the VTU regulation documents.
 *
 * The manifest is tracked provenance metadata (the raw HTTrack harvest is not in
 * git). This suite is the gate that keeps it honest: every entry must cite an
 * official vtu.ac.in URL, carry a real SHA-256, and only claim `verified` when it
 * actually has a readable text layer. No regulation values live here — those are
 * in the rule sets (packages/academic-rules); this only proves provenance shape.
 */
import { describe, expect, it } from 'vitest';
import manifest from '../data/regulations-manifest.json' with { type: 'json' };

const DOC_TYPES = new Set([
  'BASE_REGULATION',
  'AMENDMENT',
  'NOTIFICATION',
  'TRANSITION_RULE',
  'READMISSION_RULE',
  'EXAM_RULE',
  'PROJECT_RULE',
  'INTERNSHIP_RULE',
  'ANNEXURE',
  'OTHER',
]);
const OCR_STATUS = new Set(['text_layer', 'partial', 'scanned']);

describe('regulations manifest', () => {
  it('count fields agree with the document list', () => {
    expect(manifest.documents).toHaveLength(manifest.count);
    expect(manifest.documents.filter((d) => d.verified)).toHaveLength(manifest.verifiedCount);
  });

  it('every document cites an official vtu.ac.in source URL, once', () => {
    const urls = manifest.documents.map((d) => d.source_url);
    for (const url of urls) expect(url).toMatch(/^https:\/\/vtu\.ac\.in\//);
    expect(new Set(urls).size).toBe(urls.length); // no duplicates
  });

  it('every document carries a real SHA-256 and a positive page count', () => {
    for (const d of manifest.documents) {
      expect(d.sha256, d.filename).toMatch(/^[0-9a-f]{64}$/);
      expect(d.pages, d.filename).toBeGreaterThan(0);
      expect(d.filename.length).toBeGreaterThan(0);
    }
  });

  it('every document has a known type and OCR status', () => {
    for (const d of manifest.documents) {
      expect(DOC_TYPES.has(d.document_type), `${d.filename}: ${d.document_type}`).toBe(true);
      expect(OCR_STATUS.has(d.ocr_status), `${d.filename}: ${d.ocr_status}`).toBe(true);
      expect(typeof d.verified).toBe('boolean');
    }
  });

  it('only a readable text layer may be marked verified — scanned content is never "verified"', () => {
    for (const d of manifest.documents) {
      if (d.verified) expect(d.ocr_status, d.filename).toBe('text_layer');
      if (d.ocr_status === 'scanned') expect(d.verified, d.filename).toBe(false);
    }
  });

  it('covers every expected base-regulation scheme year', () => {
    const baseSchemes = new Set(
      manifest.documents
        .filter((d) => d.document_type === 'BASE_REGULATION')
        .map((d) => d.scheme),
    );
    for (const s of ['2002', '2006', '2010', '2015-16', '2017-18', '2018-19', '2021', '2022', '2025']) {
      expect(baseSchemes.has(s), `base regulation for ${s}`).toBe(true);
    }
  });

  it('the 2025 base regulation is the official document and is verified', () => {
    const r2025 = manifest.documents.find(
      (d) => d.scheme === '2025' && d.document_type === 'BASE_REGULATION',
    );
    expect(r2025?.source_url).toBe('https://vtu.ac.in/wp-content/uploads/2026/05/B.E.B.Tech2025.pdf');
    expect(r2025?.verified).toBe(true);
    expect(r2025?.effective_date).toBe('2025-26');
  });

  it('every amendment names what it modifies or is explicitly unresolved', () => {
    for (const d of manifest.documents.filter((x) => x.document_type === 'AMENDMENT')) {
      // Either a stated target, or a note that records the uncertainty.
      const resolved = d.modifies !== null || /unresolved/i.test(d.notes ?? '');
      expect(resolved, `${d.filename} amendment target`).toBe(true);
    }
  });
});
