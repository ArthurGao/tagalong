const HAN = /\p{Script=Han}/u;

/**
 * Public display name (DESIGN §10): "Arthur Gao" → "Arthur G.", "高阳" → "高*". A single Latin word is a
 * given name and stays as typed. Email and phone never leave the backend on public routes.
 */
export function maskName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '*';
  if (words.length === 1) {
    const [word] = words;
    // Chinese names are written surname first: keep the surname, hide the rest.
    return HAN.test(word) ? `${[...word][0]}${'*'.repeat([...word].length - 1)}` : word;
  }
  return `${words[0]} ${[...words[words.length - 1]][0].toUpperCase()}.`;
}
