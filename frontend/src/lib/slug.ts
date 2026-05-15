/**
 * Convert a label like "BLK 113 BISHAN ST 12" or "Tampines East" into a
 * URL-safe slug for canonical entity URLs. Slug is purely cosmetic — the
 * router only ever uses the leading id — but Google rewards descriptive
 * URLs, so we include the slug whenever we can.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
