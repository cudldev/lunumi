import { describe, expect, it } from 'vitest';
import { makeAnnotationRecord, trainingSourceMetadata, validateCandidateForAnnotation } from './menu-training-annotation.mjs';

const candidate = {
  schema: 1,
  sourceName: 'Licensed menu feed',
  sourceUrl: 'https://restaurant.example/feed.json',
  sourceRightsEvidenceUrl: 'https://restaurant.example/terms',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  permissionBasis: 'written-permission',
  rightsReviewedAt: '2026-10-27',
  approvedForModelRelease: true,
  commercialUseApproved: true,
  language: 'fi',
  text: 'Paahdettu kasviskeitto',
  contentHash: 'a'.repeat(64),
};

describe('private training annotation', () => {
  it('requires explicit release, commercial, and written-rights evidence before labeling', () => {
    expect(() => validateCandidateForAnnotation({ ...candidate, commercialUseApproved: false }))
      .toThrow(/future commercial use/);
    expect(() => validateCandidateForAnnotation({ ...candidate, sourceRightsEvidenceUrl: undefined }))
      .toThrow(/rights evidence URL/);
  });

  it('rejects noncommercial and no-derivatives licenses unless separate written permission is recorded', () => {
    const explicit = { ...candidate, permissionBasis: 'explicit-license' };
    expect(() => validateCandidateForAnnotation({ ...explicit, license: 'CC BY-NC 4.0' }))
      .toThrow(/Noncommercial licenses/);
    expect(() => validateCandidateForAnnotation({ ...explicit, license: 'CC BY-ND 4.0' }))
      .toThrow(/NoDerivatives licenses/);
    expect(() => validateCandidateForAnnotation({ ...explicit, license: 'CC BY-NC 4.0', permissionBasis: 'written-permission' }))
      .not.toThrow();
  });

  it('requires official reuse evidence for government open-data terms', () => {
    expect(() => validateCandidateForAnnotation({
      ...candidate,
      permissionBasis: 'open-data-terms',
      rightsEvidenceUrl: undefined,
      sourceRightsEvidenceUrl: undefined,
    })).toThrow(/official reuse-terms evidence URL/);
    expect(() => validateCandidateForAnnotation({
      ...candidate,
      permissionBasis: 'open-data-terms',
      rightsEvidenceUrl: 'https://city.example/open-data-terms',
      sourceRightsEvidenceUrl: undefined,
    })).not.toThrow();
  });

  it('adds a reviewed label without dropping provenance or permissions', () => {
    const record = makeAnnotationRecord(candidate, 'dish', '2026-10-27T12:00:00.000Z');
    expect(record).toMatchObject({
      text: candidate.text,
      label: 'dish',
      labelReviewedAt: '2026-10-27T12:00:00.000Z',
      sourceRightsEvidenceUrl: candidate.sourceRightsEvidenceUrl,
      approvedForModelRelease: true,
      commercialUseApproved: true,
      language: 'fi',
    });
    expect(() => makeAnnotationRecord(candidate, 'unreviewed')).toThrow(/Unsupported label/);
  });

  it('preserves written-permission evidence when the trainer builds source metadata', () => {
    expect(trainingSourceMetadata(candidate)).toMatchObject({
      sourceUrl: candidate.sourceUrl,
      license: candidate.license,
      permissionBasis: 'written-permission',
      rightsReviewedAt: '2026-10-27',
      rightsEvidenceUrl: candidate.sourceRightsEvidenceUrl,
    });
  });
});
