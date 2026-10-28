export const trainingLabels = new Set(['dish', 'section', 'other']);

export function validateCommercialLicense(source) {
  if (source?.permissionBasis === 'written-permission') return;
  const licenseText = `${source?.license ?? ''} ${source?.licenseUrl ?? ''}`.toLowerCase();
  if (/\bnon[-\s]?commercial\b|\bby[-_\s]?nc\b|creativecommons\.org\/licenses\/by-nc\//i.test(licenseText)) {
    throw new Error('Noncommercial licenses cannot be used for commercial model training without separate written permission.');
  }
  if (/\bno[-\s]?derivatives\b|\bby[-_\s]?nd\b|creativecommons\.org\/licenses\/by-nd\//i.test(licenseText)) {
    throw new Error('NoDerivatives licenses cannot be used to release commercial model weights without separate written permission.');
  }
}

export function trainingSourceMetadata(example) {
  return example.source ?? {
    name: example.sourceName,
    sourceUrl: example.sourceUrl,
    license: example.license,
    licenseUrl: example.licenseUrl,
    permissionBasis: example.permissionBasis,
    rightsReviewedAt: example.rightsReviewedAt,
    rightsEvidenceUrl: example.rightsEvidenceUrl || example.sourceRightsEvidenceUrl,
    approvedForModelRelease: example.approvedForModelRelease,
    commercialUseApproved: example.commercialUseApproved,
  };
}

export function validateCandidateForAnnotation(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('Candidate must be an object.');
  if (!['fi', 'sv', 'en', 'fr'].includes(candidate.language)) throw new Error('Candidate has an unsupported language.');
  if (typeof candidate.text !== 'string' || !candidate.text.trim()) throw new Error('Candidate text is empty.');
  if (typeof candidate.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(candidate.contentHash)) {
    throw new Error('Candidate needs its SHA-256 content hash.');
  }
  if (candidate.approvedForModelRelease !== true || candidate.commercialUseApproved !== true) {
    throw new Error('Candidate is not approved for released weights and future commercial use.');
  }
  if (!candidate.sourceUrl || !candidate.license || !candidate.licenseUrl
    || !['explicit-license', 'written-permission', 'open-data-terms'].includes(candidate.permissionBasis)) {
    throw new Error('Candidate is missing its source URL, license, or permission basis.');
  }
  validateCommercialLicense(candidate);
  if (typeof candidate.rightsReviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.rightsReviewedAt)) {
    throw new Error('Candidate needs its rights-review date in YYYY-MM-DD format.');
  }
  if (candidate.permissionBasis === 'written-permission'
    && !(candidate.sourceRightsEvidenceUrl || candidate.rightsEvidenceUrl)) {
    throw new Error('Written-permission candidates need a rights evidence URL.');
  }
  if (candidate.permissionBasis === 'open-data-terms'
    && !(candidate.sourceRightsEvidenceUrl || candidate.rightsEvidenceUrl)) {
    throw new Error('Open-data-terms candidates need an official reuse-terms evidence URL.');
  }
}

export function makeAnnotationRecord(candidate, label, reviewedAt = new Date().toISOString()) {
  validateCandidateForAnnotation(candidate);
  if (!trainingLabels.has(label)) throw new Error(`Unsupported label: ${label}`);
  return { ...candidate, label, labelReviewedAt: reviewedAt };
}
