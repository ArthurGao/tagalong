// OG images are rendered on the server by Satori, which has no CJK glyphs. UI-STYLE's "no web CJK fonts" rule
// is about browser pages; here we fetch a Noto Sans SC subset holding only the characters the image uses.

const FONT_TIMEOUT_MS = 3000;
export const OG_FONT_WEIGHT = 700;
const DAY_S = 86_400;

/** The TrueType/OpenType URL from a Google Fonts css2 response (Satori cannot read woff2). */
export function extractFontUrl(css: string): string | null {
  return /src:\s*url\(([^)]+)\)\s*format\(['"](?:truetype|opentype)['"]\)/.exec(css)?.[1] ?? null;
}

/**
 * Subset font data, or null when the text needs none (Latin only: Satori's default font covers it) or Google Fonts
 * is unreachable (the image then falls back to the default font). The URL names the glyph set, so it caches well.
 */
export async function loadCjkFont(text: string): Promise<ArrayBuffer | null> {
  if (!/[^\u0000-\u024f\u2000-\u206f]/.test(text)) return null;
  const chars = [...new Set(text)].join('');
  const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${OG_FONT_WEIGHT}&text=${encodeURIComponent(chars)}`;
  try {
    const init = { signal: AbortSignal.timeout(FONT_TIMEOUT_MS), next: { revalidate: DAY_S } };
    const css = await (await fetch(url, init)).text();
    const fontUrl = extractFontUrl(css);
    if (!fontUrl) return null;
    const res = await fetch(fontUrl, init);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}
