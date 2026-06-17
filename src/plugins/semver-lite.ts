/**
 * Minimal semver implementation for plugin compatibility checks.
 * Supports the subset of ranges plugins are likely to declare:
 *   ^1.0.0   ~1.0.0   >=1.0.0   <=2.0.0   >1.0.0 <2.0.0   1.0.0   *
 *
 * Does NOT support pre-release tags, build metadata, or complex comparators.
 * If a range can't be parsed, satisfies() throws — callers should catch.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parse(v: string): SemVer {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Invalid version: ${v}`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

export function compare(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Returns true if version `v` satisfies range `range`.
 * Throws on unparseable input.
 */
export function satisfies(v: string, range: string): boolean {
  const version = parse(v);
  const rangeTrim = range.trim();

  if (rangeTrim === '*' || rangeTrim === '') return true;

  // Handle space-separated comparators (AND): ">1.0.0 <2.0.0"
  const parts = rangeTrim.split(/\s+/);
  for (const part of parts) {
    if (!satisfiesSingle(version, part)) return false;
  }
  return true;
}

function satisfiesSingle(version: SemVer, part: string): boolean {
  // Caret: ^1.2.3 := >=1.2.3 <2.0.0 (same major, >= target)
  const caret = part.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (caret) {
    const target = { major: Number(caret[1]), minor: Number(caret[2]), patch: Number(caret[3]) };
    // Must be same major (caret does not cross major versions)
    if (version.major !== target.major) return false;
    // Within the same major, must be >= target
    if (version.minor !== target.minor) return version.minor > target.minor;
    return version.patch >= target.patch;
  }

  // Tilde: ~1.2.3 := >=1.2.3 <1.3.0 (same major+minor, patch >= target)
  const tilde = part.match(/^~(\d+)\.(\d+)\.(\d+)$/);
  if (tilde) {
    const target = { major: Number(tilde[1]), minor: Number(tilde[2]), patch: Number(tilde[3]) };
    // Must be same major and minor
    if (version.major !== target.major) return false;
    if (version.minor !== target.minor) return false;
    return version.patch >= target.patch;
  }

  // >= <= > < =
  const op = part.match(/^(>=|<=|>|<|=|)(\d+)\.(\d+)\.(\d+)$/);
  if (op) {
    const target = { major: Number(op[2]), minor: Number(op[3]), patch: Number(op[4]) };
    const cmp = compare(version, target);
    const operator = op[1] || '=';
    switch (operator) {
      case '>=': return cmp >= 0;
      case '<=': return cmp <= 0;
      case '>': return cmp > 0;
      case '<': return cmp < 0;
      case '=': return cmp === 0;
    }
  }

  // Exact version (no operator)
  const exact = part.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (exact) {
    const target = { major: Number(exact[1]), minor: Number(exact[2]), patch: Number(exact[3]) };
    return compare(version, target) === 0;
  }

  // Bare major: "1" or "1.x"
  const bare = part.match(/^(\d+)(?:\.x)?$/);
  if (bare) {
    return version.major === Number(bare[1]);
  }

  throw new Error(`Unsupported range syntax: ${part}`);
}
