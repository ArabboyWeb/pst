#!/usr/bin/env node
/**
 * Real-world validation harness.
 *
 * Runs `pst detect --format json --offline` against every directory under
 * the given root and prints a compact per-repo summary to stdout, plus a
 * full JSON dump to stderr.
 *
 * Usage: node scripts/realworld.js /tmp/pst-realworld
 */
import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.argv[2] ?? '/tmp/pst-realworld';
const PST_BIN = path.resolve(process.cwd(), 'dist/cli.js');

async function main() {
  const entries = await readdir(ROOT);
  const dirs = [];
  for (const e of entries) {
    const p = path.join(ROOT, e);
    const s = await stat(p);
    if (s.isDirectory()) dirs.push(p);
  }
  dirs.sort();

  const results = [];
  for (const dir of dirs) {
    const name = path.basename(dir);
    const { json, stderr, exitCode } = await runPst(dir);
    results.push({ name, dir, exitCode, json, stderr });
  }

  // Print compact summary
  console.log('repo'.padEnd(20), 'langs'.padEnd(20), 'pms'.padEnd(15), 'frameworks'.padEnd(25), 'overall'.padEnd(15), 'diag');
  console.log('-'.repeat(110));
  for (const r of results) {
    const j = r.json;
    if (!j) {
      console.log(r.name.padEnd(20), '(parse failed)'.padEnd(20), '', '', '', r.stderr.slice(0, 80));
      continue;
    }
    const langs = j.languages.map((l) => l.id).join(',') || '-';
    const pms = j.packageManagers.map((p) => p.id).join(',') || '-';
    const fws = j.frameworks.map((f) => f.id).join(',') || '-';
    const overall = j.overall ? `${j.overall.level}(${j.overall.score})` : '-';
    const diag = j.diagnostics.length;
    console.log(
      r.name.padEnd(20),
      langs.padEnd(20),
      pms.padEnd(15),
      fws.padEnd(25),
      overall.padEnd(15),
      `${diag} (${j.diagnostics.filter((d) => d.severity === 'error').length} err)`,
    );
  }

  // Dump full JSON to stderr
  process.stderr.write(JSON.stringify(results.map((r) => ({
    name: r.name,
    exitCode: r.exitCode,
    languages: r.json?.languages ?? [],
    frameworks: r.json?.frameworks ?? [],
    packageManagers: r.json?.packageManagers ?? [],
    manifests: r.json?.manifests?.map((m) => m.path) ?? [],
    installPlan: r.json?.installPlan?.steps?.map((s) => s.command) ?? [],
    runPlan: r.json?.runPlan?.steps?.map((s) => s.command) ?? [],
    buildPlan: r.json?.buildPlan?.steps?.map((s) => s.command) ?? [],
    testPlan: r.json?.testPlan?.steps?.map((s) => s.command) ?? [],
    deployPlan: r.json?.deployPlan ?? null,
    diagnostics: r.json?.diagnostics ?? [],
    overall: r.json?.overall ?? null,
    stderrTail: r.stderr.slice(-200),
  })), null, 2));
}

function runPst(dir) {
  return new Promise((resolve) => {
    const child = spawn('node', [PST_BIN, 'detect', dir, '--offline', '--format', 'json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (exitCode) => {
      let json = null;
      try { json = JSON.parse(stdout); } catch { json = null; }
      resolve({ json, stderr, exitCode });
    });
    child.on('error', () => resolve({ json: null, stderr, exitCode: -1 }));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
