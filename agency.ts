// Duplicate detection. Never merges automatically; only flags candidates for admin.
export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const bigrams = (s: string) => { const r = new Set<string>(); for (let i = 0; i < s.length - 1; i++) r.add(s.slice(i, i + 2)); return r; };
export function similarity(a: string, b: string): number {
  const x = bigrams(normalize(a)), y = bigrams(normalize(b));
  if (!x.size || !y.size) return 0;
  let n = 0; x.forEach(g => y.has(g) && n++);
  return (2 * n) / (x.size + y.size); // Dice coefficient
}
export const findDuplicates = (name: string, existing: {id: string; name: string}[], threshold = 0.85) =>
  existing.filter(e => normalize(e.name) === normalize(name) || similarity(name, e.name) >= threshold);
