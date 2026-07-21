import { parse as parseYaml } from 'yaml';

/**
 * Minimal frontmatter parser. Only supports YAML (the `---` delimiter).
 * Does NOT support `---js` / `---javascript` to avoid eval()-based RCE
 * that exists in gray-matter's built-in JS engine.
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  // Strip UTF-8 BOM if present — some editors (e.g., Notepad on Windows)
  // prepend \uFEFF, which prevents the ^--- anchor from matching.
  const stripped = raw.replace(/^\uFEFF/, '');
  const match = stripped.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: stripped };
  const data = (parseYaml(match[1]!) as Record<string, unknown>) ?? {};
  return { data, content: match[2] ?? '' };
}
