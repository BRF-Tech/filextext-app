// Markdown import helpers. BlockSuite exports a page's title as its leading
// `# Heading`; importing takes it back, so a page survives export → import
// → export unchanged instead of growing a second heading each time.

/**
 * The title of an imported Markdown file and the rest of it. A level-1 ATX
 * heading on the first non-blank line (after optional YAML front matter) is
 * the title and leaves the body; otherwise the title is `fallback` (the file
 * name) and the body is untouched.
 */
export function splitTitle(markdown: string, fallback: string): { title: string; body: string } {
  const text = markdown ?? '';
  const lines = text.split('\n');
  let i = 0;
  let frontEnd = -1;
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((l, n) => n > 0 && (l.trim() === '---' || l.trim() === '...'));
    if (close > 0) {
      frontEnd = close;
      i = close + 1;
    }
  }
  while (i < lines.length && lines[i].trim() === '') i++;
  const m = /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*\r?$/.exec(lines[i] ?? '');
  if (!m || !m[1].trim()) return { title: fallback, body: text };
  const kept = [...(frontEnd >= 0 ? lines.slice(0, frontEnd + 1) : []), ...lines.slice(i + 1)];
  // Drop the blank lines the heading left at the start of the body.
  let start = frontEnd >= 0 ? frontEnd + 1 : 0;
  while (start < kept.length && kept[start].trim() === '') kept.splice(start, 1);
  return { title: m[1].trim(), body: kept.join('\n') };
}
