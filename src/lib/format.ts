/**
 * Formatting and normalization utilities for ClinicBook.
 */

/**
 * Strips duplicate or leading Arabic doctor honorific prefixes
 * (د., د/, د:, دكتور, دكتورة, الدكتور, الدكتورة, أ.د., etc.)
 *
 * @param name The doctor's name string, possibly containing duplicate or leading titles
 * @returns Clean doctor name without title prefix
 */
export function cleanDoctorName(name?: string | null): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/^(د\s*[\.\/:]\s*|دكتور(ة)?\s+|الدكتور(ة)?\s+|أ\s*[\.]?\s*د\s*[\.]?\s*)+/u, '')
    .trim();
}

/**
 * Returns a properly formatted doctor name with exactly one title prefix (e.g. "د. أحمد الحسن").
 * Idempotent: even if input already has "د. " or "د. د. ", only a single prefix is rendered.
 *
 * @param name The doctor's name string
 * @param prefix The title prefix to prepend (defaults to 'د.')
 * @returns Formatted name with single prefix, or empty string if input is blank
 */
export function formatDoctorName(name?: string | null, prefix = 'د.'): string {
  const clean = cleanDoctorName(name);
  if (!clean) return '';
  return `${prefix} ${clean}`;
}
