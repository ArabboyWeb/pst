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
// Text
// ---------------------------------------------------------------------------

export function renderText(scan: ProjectScanResult): string {
  const lines: string[] = [];

  lines.push(chalk.bold.cyan('PST — Project Intelligence Report'));
  lines.push(chalk.gray(`Scanned: ${scan.root}`));
  lines.push(chalk.gray(`At:      ${scan.scannedAt}`));
  lines.push(chalk.gray(`Overall: ${fmtConfidence(scan.overall)}`));
  lines.push('');

  if (scan.languages.length > 0) {
    lines.push(chalk.bold.white('Languages'));
    for (const l of scan.languages) {
      lines.push(
        `  ${chalk.green('•')} ${l.name} ${l.versionConstraint ? chalk.gray(`(requires ${l.versionConstraint})`) : ''} ${chalk.gray(`— ${fmtConfidence(l.confidence)}`)}`,
      );
      lines.push(chalk.gray(`      evidence: ${l.evidence.join(', ')}`));
    }
    lines.push('');
  }

  if (scan.frameworks.length > 0) {
    lines.push(chalk.bold.white('Frameworks'));
    for (const f of scan.frameworks) {
      lines.push(
        `  ${chalk.green('•')} ${f.name} ${chalk.gray(`— ${fmtConfidence(f.confidence)}`)}`,
      );
      lines.push(chalk.gray(`      evidence: ${f.evidence.join(', ')}`));
    }
    lines.push('');
  }

  if (scan.packageManagers.length > 0) {
    lines.push(chalk.bold.white('Package managers'));
    for (const pm of scan.packageManagers) {
      lines.push(
        `  ${chalk.green('•')} ${pm.name} ${pm.binary ? chalk.gray(`(binary: ${pm.binary})`) : ''} ${chalk.gray(`— ${fmtConfidence(pm.confidence)}`)}`,
      );
      if (pm.lockfiles.length > 0) {
        lines.push(chalk.gray(`      lockfiles: ${pm.lockfiles.join(', ')}`));
      }
    }
    lines.push('');
  }

  if (scan.manifests.length > 0) {
    lines.push(chalk.bold.white('Manifests'));
    for (const m of scan.manifests) {
      lines.push(`  ${chalk.green('•')} ${m.path}`);
    }
    lines.push('');
  }

  if (scan.env.length > 0) {
    lines.push(chalk.bold.white('Environment'));
    for (const e of scan.env) {
      lines.push(`  ${chalk.green('•')} ${e.path} ${chalk.gray(`(${e.kind})`)}`);
      for (const v of e.variables.slice(0, 12)) {
        const def = v.defaultValue !== undefined ? chalk.gray(`=${v.defaultValue}`) : '';
        const req = v.required ? chalk.yellow(' [required]') : '';
        lines.push(chalk.gray(`      ${v.name}${def}${req}`));
      }
      if (e.variables.length > 12) {
        lines.push(chalk.gray(`      … and ${e.variables.length - 12} more`));
      }
    }
    lines.push('');
  }

  if (scan.entrypoints.length > 0) {
    lines.push(chalk.bold.white('Entrypoints'));
    for (const e of scan.entrypoints) {
      lines.push(`  ${chalk.green('•')} ${e}`);
    }
    lines.push('');
  }

  pushPlanSection(lines, 'Install plan', scan.installPlan.steps, scan.installPlan.notes);
  pushPlanSection(lines, 'Run plan', scan.runPlan.steps, scan.runPlan.notes);
  pushPlanSection(lines, 'Build plan', scan.buildPlan.steps, scan.buildPlan.notes);
  pushPlanSection(lines, 'Test plan', scan.testPlan.steps, scan.testPlan.notes);

  // Deploy
  lines.push(chalk.bold.white('Deploy plan'));
  if (scan.deployPlan.targets.length > 0) {
    lines.push(chalk.gray(`  targets:   ${scan.deployPlan.targets.join(', ')}`));
    lines.push(chalk.gray(`  readiness: ${scan.deployPlan.readiness}`));
  }
  if (scan.deployPlan.steps.length > 0) {
    for (const s of scan.deployPlan.steps) {
      lines.push(`  ${chalk.green('•')} ${s.label} ${chalk.gray(`— ${fmtConfidence(s.confidence)}`)}`);
      lines.push(chalk.gray(`      $ ${s.command}`));
    }
  }
  for (const n of scan.deployPlan.notes) lines.push(chalk.gray(`  note: ${n}`));
  lines.push('');

  if (scan.diagnostics.length > 0) {
    lines.push(chalk.bold.white('Diagnostics'));
    for (const d of scan.diagnostics) {
      const icon =
        d.severity === 'error' ? chalk.red('✗') :
        d.severity === 'warn' ? chalk.yellow('!') :
        chalk.blue('i');
      lines.push(`  ${icon} ${chalk.gray(`[${d.code}]`)} ${d.message}`);
      if (d.path) lines.push(chalk.gray(`      file: ${d.path}`));
      if (d.nextStep) lines.push(chalk.gray(`      fix:  ${d.nextStep}`));
    }
    lines.push('');
  }

  return lines.join('\n');
}

function pushPlanSection(
  lines: string[],
  title: string,
  steps: ProjectScanResult['installPlan']['steps'],
  notes: string[],
): void {
  lines.push(chalk.bold.white(title));
  if (steps.length === 0) {
    lines.push(chalk.gray('  (none)'));
  }
  for (const s of steps) {
    lines.push(`  ${chalk.green('•')} ${s.label} ${chalk.gray(`— ${fmtConfidence(s.confidence)}`)}`);
    lines.push(chalk.gray(`      $ ${s.command}`));
    if (s.requiredEnv && s.requiredEnv.length > 0) {
      lines.push(chalk.gray(`      needs env: ${s.requiredEnv.join(', ')}`));
    }
  }
  for (const n of notes) lines.push(chalk.gray(`  note: ${n}`));
  lines.push('');
}

function fmtConfidence(c: Confidence): string {
  const color =
    c.level === 'high' ? chalk.green :
    c.level === 'medium' ? chalk.yellow :
    chalk.red;
  return `${color(c.level)} (${c.score.toFixed(2)})`;
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
        const def = v.defaultValue !== undefined ? `=\`${v.defaultValue}\`` : '';
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
