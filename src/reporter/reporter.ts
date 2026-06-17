import chalk from 'chalk';
import type {
  Confidence,
  ConfidenceLevel,
  ProjectScanResult,
  Report,
  ReportFormat,
} from '../types/index.js';

/**
 * Render a scan result in the requested format.
 */
export function renderReport(
  scan: ProjectScanResult,
  format: ReportFormat,
): Report {
  switch (format) {
    case 'json':
      return { format, content: JSON.stringify(scan, null, 2) };
    case 'markdown':
      return { format, content: renderMarkdown(scan) };
    case 'text':
    default:
      return { format, content: renderText(scan) };
  }
}

// ---------------------------------------------------------------------------
// Text — premium CLI output
// ---------------------------------------------------------------------------

const SEPARATOR = chalk.dim('─'.repeat(60));
const THIN_SEP  = chalk.dim('┄'.repeat(40));

function badge(c: Confidence): string {
  const pct = Math.round(c.score * 100);
  if (c.level === 'high')   return chalk.bgGreen.black.bold(` ✓ ${pct}% `);
  if (c.level === 'medium') return chalk.bgYellow.black.bold(` ~ ${pct}% `);
  return chalk.bgRed.white.bold(` ? ${pct}% `);
}

function fmtConfidence(c: Confidence): string {
  const color =
    c.level === 'high' ? chalk.green :
    c.level === 'medium' ? chalk.yellow :
    chalk.red;
  return `${color(c.level)} (${c.score.toFixed(2)})`;
}

function sectionHeader(emoji: string, title: string): string {
  return `\n${SEPARATOR}\n  ${emoji}  ${chalk.bold.white(title)}\n${SEPARATOR}`;
}

function cmdBlock(command: string): string {
  return `      ${chalk.bgGray.white(' > ')} ${chalk.cyan.bold(command)}`;
}

export function renderText(scan: ProjectScanResult): string {
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────
  lines.push('');
  lines.push(chalk.bold.cyanBright('  ⚡  PST — Project Intelligence Report'));
  lines.push(SEPARATOR);
  lines.push(`  ${chalk.dim('Path:')}     ${chalk.white(scan.root)}`);
  lines.push(`  ${chalk.dim('Scanned:')}  ${chalk.white(scan.scannedAt)}`);
  lines.push(`  ${chalk.dim('Overall:')}  ${badge(scan.overall)}`);

  // ── Languages ───────────────────────────────────────────────
  if (scan.languages.length > 0) {
    lines.push(sectionHeader('📝', 'Languages'));
    for (const l of scan.languages) {
      const ver = l.versionConstraint ? chalk.dim(` (requires ${l.versionConstraint})`) : '';
      lines.push(`  ${chalk.green('●')} ${chalk.bold.white(l.name)}${ver}  ${badge(l.confidence)}`);
      lines.push(chalk.dim(`      evidence: ${l.evidence.join(', ')}`));
    }
  }

  // ── Frameworks ──────────────────────────────────────────────
  if (scan.frameworks.length > 0) {
    lines.push(sectionHeader('🧩', 'Frameworks'));
    for (const f of scan.frameworks) {
      lines.push(`  ${chalk.magenta('●')} ${chalk.bold.white(f.name)}  ${badge(f.confidence)}`);
      lines.push(chalk.dim(`      evidence: ${f.evidence.join(', ')}`));
    }
  }

  // ── Package Managers ────────────────────────────────────────
  if (scan.packageManagers.length > 0) {
    lines.push(sectionHeader('📦', 'Package Managers'));
    for (const pm of scan.packageManagers) {
      const bin = pm.binary ? chalk.dim(` (${pm.binary})`) : '';
      lines.push(`  ${chalk.blue('●')} ${chalk.bold.white(pm.name)}${bin}  ${badge(pm.confidence)}`);
      if (pm.lockfiles.length > 0) {
        lines.push(chalk.dim(`      lockfiles: ${pm.lockfiles.join(', ')}`));
      }
    }
  }

  // ── Manifests ───────────────────────────────────────────────
  if (scan.manifests.length > 0) {
    lines.push(sectionHeader('📄', 'Manifests'));
    for (const m of scan.manifests) {
      lines.push(`  ${chalk.white('●')} ${chalk.white(m.path)}`);
    }
  }

  // ── Environment ─────────────────────────────────────────────
  if (scan.env.length > 0) {
    lines.push(sectionHeader('🔑', 'Environment'));
    for (const e of scan.env) {
      lines.push(`  ${chalk.yellow('●')} ${chalk.white(e.path)} ${chalk.dim(`(${e.kind})`)}`);
      for (const v of e.variables.slice(0, 12)) {
        const showVal = e.kind === 'example' && v.defaultValue !== undefined;
        const def = showVal
          ? chalk.dim(`=${v.defaultValue}`)
          : v.defaultValue !== undefined
            ? chalk.dim('=[set]')
            : '';
        const req = v.required ? chalk.yellow.bold(' [required]') : '';
        lines.push(`      ${chalk.dim('•')} ${chalk.white(v.name)}${def}${req}`);
      }
      if (e.variables.length > 12) {
        lines.push(chalk.dim(`      … and ${e.variables.length - 12} more`));
      }
    }
  }

  // ── Entrypoints ─────────────────────────────────────────────
  if (scan.entrypoints.length > 0) {
    lines.push(sectionHeader('🚪', 'Entrypoints'));
    for (const e of scan.entrypoints) {
      lines.push(`  ${chalk.white('●')} ${chalk.white(e)}`);
    }
  }

  // ── Plans ───────────────────────────────────────────────────
  pushPlanSection(lines, '🛠️',  'Install Plan', scan.installPlan.steps, scan.installPlan.notes);
  pushPlanSection(lines, '▶️',  'Run Plan',     scan.runPlan.steps,     scan.runPlan.notes);
  pushPlanSection(lines, '⚡', 'Build Plan',   scan.buildPlan.steps,   scan.buildPlan.notes);
  pushPlanSection(lines, '🧪', 'Test Plan',    scan.testPlan.steps,    scan.testPlan.notes);

  // ── Deploy ──────────────────────────────────────────────────
  lines.push(sectionHeader('🚀', 'Deploy Plan'));
  if (scan.deployPlan.targets.length > 0) {
    lines.push(`  ${chalk.dim('targets:')}   ${chalk.white(scan.deployPlan.targets.join(', '))}`);
    const readyColor = scan.deployPlan.readiness === 'ready' ? chalk.green : chalk.yellow;
    lines.push(`  ${chalk.dim('readiness:')} ${readyColor(scan.deployPlan.readiness)}`);
  }
  if (scan.deployPlan.steps.length > 0) {
    lines.push(THIN_SEP);
    for (const s of scan.deployPlan.steps) {
      lines.push(`  ${chalk.green('●')} ${chalk.bold.white(s.label)}  ${badge(s.confidence)}`);
      lines.push(cmdBlock(s.command));
    }
  }
  for (const n of scan.deployPlan.notes) {
    lines.push(`  ${chalk.dim('💡 note:')} ${chalk.dim(n)}`);
  }

  // ── Diagnostics ─────────────────────────────────────────────
  if (scan.diagnostics.length > 0) {
    lines.push(sectionHeader('🔍', 'Diagnostics'));
    for (const d of scan.diagnostics) {
      const icon =
        d.severity === 'error' ? chalk.red.bold('✗') :
        d.severity === 'warn'  ? chalk.yellow.bold('⚠') :
        chalk.blue('ℹ');
      lines.push(`  ${icon} ${chalk.dim(`[${d.code}]`)} ${chalk.white(d.message)}`);
      if (d.path) lines.push(chalk.dim(`      file: ${d.path}`));
      if (d.nextStep) lines.push(`      ${chalk.green('→')} ${chalk.green(d.nextStep)}`);
    }
  }

  lines.push('');
  lines.push(SEPARATOR);
  lines.push(chalk.dim('  Powered by PST — https://github.com/ArabboyWeb/pst'));
  lines.push('');

  return lines.join('\n');
}

function pushPlanSection(
  lines: string[],
  emoji: string,
  title: string,
  steps: ProjectScanResult['installPlan']['steps'],
  notes: string[],
): void {
  lines.push(sectionHeader(emoji, title));
  if (steps.length === 0) {
    lines.push(chalk.dim('  (none detected)'));
  }
  for (const s of steps) {
    lines.push(`  ${chalk.green('●')} ${chalk.bold.white(s.label)}  ${badge(s.confidence)}`);
    lines.push(cmdBlock(s.command));
    if (s.requiredEnv && s.requiredEnv.length > 0) {
      lines.push(`      ${chalk.yellow('🔑')} ${chalk.dim('needs env:')} ${chalk.yellow(s.requiredEnv.join(', '))}`);
    }
  }
  for (const n of notes) {
    lines.push(`  ${chalk.dim('💡 note:')} ${chalk.dim(n)}`);
  }
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function renderMarkdown(scan: ProjectScanResult): string {
  const lines: string[] = [];
  lines.push(`# PST Report — ${scan.root}`);
  lines.push('');
  lines.push(`- Scanned at: \`${scan.scannedAt}\``);
  lines.push(`- Overall confidence: **${scan.overall.level}** (${scan.overall.score})`);
  lines.push('');

  lines.push('## Languages');
  if (scan.languages.length === 0) lines.push('_(none detected)_');
  for (const l of scan.languages) {
    lines.push(`- **${l.name}** ${l.versionConstraint ? `(requires ${l.versionConstraint})` : ''} — ${mdConf(l.confidence)}`);
    lines.push(`  - evidence: ${l.evidence.join(', ')}`);
  }
  lines.push('');

  lines.push('## Frameworks');
  if (scan.frameworks.length === 0) lines.push('_(none detected)_');
  for (const f of scan.frameworks) {
    lines.push(`- **${f.name}** — ${mdConf(f.confidence)}`);
    lines.push(`  - evidence: ${f.evidence.join(', ')}`);
  }
  lines.push('');

  lines.push('## Package managers');
  if (scan.packageManagers.length === 0) lines.push('_(none detected)_');
  for (const pm of scan.packageManagers) {
    lines.push(`- **${pm.name}** (binary: \`${pm.binary}\`) — ${mdConf(pm.confidence)}`);
    if (pm.lockfiles.length > 0) lines.push(`  - lockfiles: ${pm.lockfiles.join(', ')}`);
  }
  lines.push('');

  lines.push('## Manifests');
  if (scan.manifests.length === 0) lines.push('_(none)_');
  for (const m of scan.manifests) lines.push(`- \`${m.path}\` (${m.kind})`);
  lines.push('');

  if (scan.env.length > 0) {
    lines.push('## Environment');
    for (const e of scan.env) {
      lines.push(`- \`${e.path}\` (${e.kind})`);
      for (const v of e.variables) {
        const showVal = e.kind === 'example' && v.defaultValue !== undefined;
        const def = showVal
          ? `=\`${v.defaultValue}\``
          : v.defaultValue !== undefined
            ? '=`[set]`'
            : '';
        const req = v.required ? ' _(required)_' : '';
        lines.push(`  - \`${v.name}\`${def}${req}`);
      }
    }
    lines.push('');
  }

  if (scan.entrypoints.length > 0) {
    lines.push('## Entrypoints');
    for (const e of scan.entrypoints) lines.push(`- \`${e}\``);
    lines.push('');
  }

  pushMdPlan(lines, 'Install plan', scan.installPlan.steps, scan.installPlan.notes);
  pushMdPlan(lines, 'Run plan', scan.runPlan.steps, scan.runPlan.notes);
  pushMdPlan(lines, 'Build plan', scan.buildPlan.steps, scan.buildPlan.notes);
  pushMdPlan(lines, 'Test plan', scan.testPlan.steps, scan.testPlan.notes);

  lines.push('## Deploy plan');
  lines.push(`- targets: ${scan.deployPlan.targets.join(', ')}`);
  lines.push(`- readiness: **${scan.deployPlan.readiness}**`);
  for (const s of scan.deployPlan.steps) {
    lines.push(`- ${s.label} — ${mdConf(s.confidence)}`);
    lines.push(`  - \`\`\`sh`);
    lines.push(`    ${s.command}`);
    lines.push(`    \`\`\``);
  }
  for (const n of scan.deployPlan.notes) lines.push(`- _note: ${n}_`);
  lines.push('');

  if (scan.diagnostics.length > 0) {
    lines.push('## Diagnostics');
    for (const d of scan.diagnostics) {
      const icon = d.severity === 'error' ? 'x' : d.severity === 'warn' ? '!' : 'i';
      lines.push(`- [${icon}] \`${d.code}\` ${d.message}`);
      if (d.path) lines.push(`  - file: \`${d.path}\``);
      if (d.nextStep) lines.push(`  - fix: ${d.nextStep}`);
    }
  }

  return lines.join('\n');
}

function pushMdPlan(
  lines: string[],
  title: string,
  steps: ProjectScanResult['installPlan']['steps'],
  notes: string[],
): void {
  lines.push(`## ${title}`);
  if (steps.length === 0) lines.push('_(none)_');
  for (const s of steps) {
    lines.push(`- **${s.label}** — ${mdConf(s.confidence)}`);
    lines.push(`  - \`\`\`sh`);
    lines.push(`    ${s.command}`);
    lines.push(`    \`\`\``);
    if (s.rationale) lines.push(`  - _why:_ ${s.rationale}`);
  }
  for (const n of notes) lines.push(`- _note: ${n}_`);
  lines.push('');
}

function mdConf(c: Confidence): string {
  return `_${c.level}_ (${c.score})`;
}

// ---------------------------------------------------------------------------
// Confidence level helpers (re-exported for convenience)
// ---------------------------------------------------------------------------

export function levelColor(level: ConfidenceLevel): (s: string) => string {
  return level === 'high' ? chalk.green : level === 'medium' ? chalk.yellow : chalk.red;
}
