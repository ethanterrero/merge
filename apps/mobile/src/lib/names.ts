// Pure name rules. No React Native imports here, so `npm test` can run this file under Node.

/**
 * What other members see of a display name: the first word plus the last word's
 * initial ('Priya Sharma' → 'Priya S.'). Mirrors `public.public_name` in
 * 0011_member_status.sql, so the Profile screen can preview it; the server's copy is
 * the one others actually get. A single word is shown as typed, and a last word with
 * no letter or digit ('Priya ...', an emoji) leaves the first word alone. Empty or
 * all-whitespace input returns null.
 */
export function publicName(displayName: string | null | undefined): string | null {
  const trimmed = (displayName ?? '').trim();
  if (trimmed === '') return null;
  const words = trimmed.split(/\s+/);
  const first = words[0];
  if (words.length === 1) return first;
  const initial = words[words.length - 1].match(/[\p{L}\p{N}]/u)?.[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}
