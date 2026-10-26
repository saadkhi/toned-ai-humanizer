/** Audit flags are structured data from the API, never React child objects. */
export function formatAuditFlag(flag) {
  if (typeof flag === 'string') return flag;
  if (!flag || typeof flag !== 'object') return 'Review this item against your original.';
  return [flag.kind, flag.value, flag.status, flag.note].filter((value) => typeof value === 'string' && value.trim()).join(' · ') || 'Review this item against your original.';
}
