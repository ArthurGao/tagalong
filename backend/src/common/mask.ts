const HAN = /\p{Script=Han}/u;
// Contact details typed into the name field. Words are letter runs, so digits alone never show; this also hides
// the name around them ("Lily 021 555 1234" → "*") and stops "arthur@example.com" reading as "arthur E.".
const CONTACT = /@|\d[\d\s()+-]{5,}\d/;

/**
 * Public display name (DESIGN §10): "Arthur Gao" → "Arthur G.", "高阳" → "高*". Fails closed: a name containing
 * Han characters keeps only its first character whatever the spacing, run-together Latin names ("ArthurGao",
 * "arthur.gao") are split before masking, and anything resembling an email or phone number becomes "*".
 * A single Latin word is a given name and stays as typed.
 */
export function maskName(name: string): string {
  if (CONTACT.test(name)) return '*';
  if (HAN.test(name)) {
    const chars = [...name.replace(/\s+/g, '')];
    // Chinese names are written surname first: keep the surname, hide the rest.
    return chars[0] + '*'.repeat(chars.length - 1);
  }
  // Words are runs of letters; a lower→upper change ("ArthurGao") also starts a new word.
  const words = name.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').match(/[\p{L}\p{M}'’]+/gu) ?? [];
  if (words.length === 0) return '*';
  if (words.length === 1) return words[0];
  return `${words[0]} ${[...words[words.length - 1]][0].toUpperCase()}.`;
}
