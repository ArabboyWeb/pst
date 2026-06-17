import JSON5 from 'json5';
import { parse as strictParseToml } from 'toml';
import { parse as parseYaml } from 'yaml';
import { readText } from './fs.js';

/**
 * Parse a JSON file (strict).
 */
export async function parseJsonFile<T = unknown>(p: string): Promise<T | null> {
  const text = await readText(p);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Parse a JSON5 file (lenient: allows comments, trailing commas).
 */
export async function parseJson5File<T = unknown>(
  p: string,
): Promise<T | null> {
  const text = await readText(p);
  if (text === null) return null;
  try {
    return JSON5.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Parse a TOML file. Tries the strict `toml` package first; if it fails
 * (the strict parser rejects some real-world pyproject.toml files that mix
 * array element types), falls back to a lenient line-based extractor that
 * recovers the fields PST actually cares about.
 *
 * The fallback is intentionally narrow: it understands the minimal subset
 * of TOML needed for pyproject.toml — section headers, simple key=value,
 * string arrays, and inline tables in arrays. It does NOT aim to be a
 * general TOML parser.
 */
export async function parseTomlFile<T = unknown>(p: string): Promise<T | null> {
  const text = await readText(p);
  if (text === null) return null;
  try {
    return strictParseToml(text) as T;
  } catch {
    return lenientTomlParse(text) as T;
  }
}

/**
 * Parse a YAML file (used for compose, CI, lockfiles).
 */
export async function parseYamlFile<T = unknown>(
  p: string,
): Promise<T | null> {
  const text = await readText(p);
  if (text === null) return null;
  try {
    return parseYaml(text) as T;
  } catch {
    return null;
  }
}

/**
 * Parse a requirements.txt-style file: one requirement per line, ignore
 * comments and blank lines. Returns raw spec strings (e.g. "fastapi==0.110").
 */
export async function parseRequirementsFile(
  p: string,
): Promise<string[] | null> {
  const text = await readText(p);
  if (text === null) return null;
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('-')) continue; // pip flags like -r, -e
    // Strip inline comment
    const commentIdx = line.indexOf(' #');
    const cleaned = commentIdx >= 0 ? line.slice(0, commentIdx).trim() : line;
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/**
 * Parse .env / .env.example files. Returns key=value pairs (value may be
 * empty). Lines starting with # are comments.
 */
export async function parseEnvFile(
  p: string,
): Promise<Array<{ name: string; value?: string }> | null> {
  const text = await readText(p);
  if (text === null) return null;
  const out: Array<{ name: string; value?: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (name) out.push({ name, value: value || undefined });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lenient TOML fallback (used when strict parser fails on real-world files)
// ---------------------------------------------------------------------------

function lenientTomlParse(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;

  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    i++;

    if (!line || line.startsWith('#')) continue;

    // Section header: [foo.bar] or [[foo.bar]]
    const sectionMatch = line.match(/^\[(\[?)([\w.-]+)\]$/);
    if (sectionMatch) {
      const isArrOfTables = sectionMatch[1] === '[';
      const path = sectionMatch[2].split('.');
      let cursor = root;
      for (let k = 0; k < path.length - 1; k++) {
        const key = path[k];
        if (typeof cursor[key] !== 'object' || cursor[key] === null || Array.isArray(cursor[key])) {
          cursor[key] = {};
        }
        cursor = cursor[key] as Record<string, unknown>;
      }
      const lastKey = path[path.length - 1];
      if (isArrOfTables) {
        const arr = Array.isArray(cursor[lastKey]) ? (cursor[lastKey] as unknown[]) : [];
        const newObj: Record<string, unknown> = {};
        arr.push(newObj);
        cursor[lastKey] = arr;
        current = newObj;
      } else {
        if (typeof cursor[lastKey] !== 'object' || cursor[lastKey] === null || Array.isArray(cursor[lastKey])) {
          cursor[lastKey] = {};
        }
        current = cursor[lastKey] as Record<string, unknown>;
      }
      continue;
    }

    // Key = value
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    let valuePart = line.slice(eq + 1).trim();

    valuePart = stripInlineComment(valuePart);

    // Multi-line array
    if (valuePart.startsWith('[') && !isBalanced(valuePart, '[', ']')) {
      while (i < lines.length && !isBalanced(valuePart, '[', ']')) {
        const next = lines[i].trim();
        i++;
        if (!next || next.startsWith('#')) continue;
        valuePart += ' ' + next;
      }
    }

    // Multi-line inline table
    if (valuePart.startsWith('{') && !isBalanced(valuePart, '{', '}')) {
      while (i < lines.length && !isBalanced(valuePart, '{', '}')) {
        const next = lines[i].trim();
        i++;
        if (!next || next.startsWith('#')) continue;
        valuePart += ' ' + next;
      }
    }

    try {
      current[key] = parseValue(valuePart);
    } catch {
      // Skip unparseable values
    }
  }

  return root;
}

function stripInlineComment(s: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) {
      return s.slice(0, i).trim();
    }
  }
  return s;
}

function isBalanced(s: string, open: string, close: string): boolean {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (const c of s) {
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === open) depth++;
      else if (c === close) depth--;
    }
  }
  return depth === 0;
}

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (v === '') return '';
  // String
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  // Boolean
  if (v === 'true') return true;
  if (v === 'false') return false;
  // Number
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  // Array
  if (v.startsWith('[') && v.endsWith(']')) {
    return parseArray(v);
  }
  // Inline table
  if (v.startsWith('{') && v.endsWith('}')) {
    return parseInlineTable(v);
  }
  // Bare scalar — treat as string
  return v;
}

function parseArray(s: string): unknown[] {
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  const parts: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let buf = '';
  for (const c of inner) {
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) {
        parts.push(buf);
        buf = '';
        continue;
      }
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);
  return parts.map((p) => parseValue(p.trim()));
}

function parseInlineTable(s: string): Record<string, unknown> {
  const inner = s.slice(1, -1).trim();
  if (!inner) return {};
  const out: Record<string, unknown> = {};
  const parts: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let buf = '';
  for (const c of inner) {
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) {
        parts.push(buf);
        buf = '';
        continue;
      }
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    out[k] = parseValue(p.slice(eq + 1).trim());
  }
  return out;
}
