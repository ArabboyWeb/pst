import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { scanProject } from '../core/index.js';
import { renderReport } from '../reporter/index.js';
import { executeSequence } from '../executor/index.js';
import { logger } from '../utils/logger.js';
import { which, versionOf } from '../utils/runtime.js';
import { PluginManager } from '../plugins/manager.js';
import type { ProjectScanResult } from '../types/index.js';
import { VERSION } from './version.js';

/**
 * Build the root CLI program. Exposed for tests.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('pst')
    .description(
      'PST — cross-language project intelligence and deployment assistant.\n' +
      'Understand a repo fast. Set it up faster.\n\n' +
      'Supports: Node.js (npm/pnpm/yarn), Python (pip/poetry/uv/pipenv), Go, Docker.\n' +
      'Safe by default: never edits your files, never runs commands without showing them first.',
    )
    .version(VERSION)
    .option('--debug', 'Enable debug logging (verbose, includes parser internals)')
    .option('--silent', 'Suppress all logging except errors')
    .hook('preAction', (cmd) => {
      const opts = cmd.opts() as { debug?: boolean; silent?: boolean };
      if (opts.debug) logger.setLevel('debug');
      else if (opts.silent) logger.setLevel('error');
      else logger.setLevel('info');
    });

  // Helper: attach the standard [path] argument and --offline flag to a
  // command. Keeps flag definitions consistent across all subcommands.
  const withStandardOpts = (cmd: Command): Command => {
    cmd.argument('[path]', 'Project root (defaults to current directory)', '.');
    cmd.option('--offline', 'Skip runtime binary presence checks (fully hermetic)');
    return cmd;
  };

  // Helper: attach the execution-related flags (-n, -y) to install/run/build/test.
  const withExecOpts = (cmd: Command): Command => {
    cmd.option('-n, --dry-run', 'Print commands without executing them');
    cmd.option('-y, --force', 'Skip confirmation prompts (use with care)');
    return cmd;
  };

  // ---- pst detect ----------------------------------------------------
  const detect = withStandardOpts(new Command('detect'));
  detect
    .description('Detect the stack, package manager, frameworks, and manifests of a project.')
    .option('-f, --format <fmt>', 'Output format: text, json, markdown', 'text')
    .action(async (target: string, opts: { format: string; offline?: boolean }) => {
      const scan = await scanProject({ root: target, offline: opts.offline });
      const fmt = normalizeFormat(opts.format);
      const report = renderReport(scan, fmt);
      process.stdout.write(report.content + '\n');
      if (scan.diagnostics.some((d) => d.severity === 'error')) {
        process.exitCode = 1;
      }
    });

  // ---- pst inspect ---------------------------------------------------
  const inspect = withStandardOpts(new Command('inspect'));
  inspect
    .description('Alias of `detect` — prints the full scan summary and plan.')
    .option('-f, --format <fmt>', 'Output format: text, json, markdown', 'text')
    .action(async (target: string, opts: { format: string; offline?: boolean }) => {
      const scan = await scanProject({ root: target, offline: opts.offline });
      const fmt = normalizeFormat(opts.format);
      const report = renderReport(scan, fmt);
      process.stdout.write(report.content + '\n');
    });

  // ---- pst plan ------------------------------------------------------
  const plan = withStandardOpts(new Command('plan'));
  plan
    .description('Print the install/run/build/test/deploy plan without executing anything.')
    .option('-f, --format <fmt>', 'Output format: text, json, markdown', 'text')
    .option('--only <kind>', 'Filter: install, run, build, test, deploy (comma-separated)')
    .action(async (target: string, opts: { format: string; only?: string; offline?: boolean }) => {
      const scan = await scanProject({ root: target, offline: opts.offline });
      const filtered = filterPlans(scan, opts.only);
      const fmt = normalizeFormat(opts.format);
      const report = renderReport(filtered, fmt);
      process.stdout.write(report.content + '\n');
    });

  // ---- pst install ---------------------------------------------------
  const install = withExecOpts(withStandardOpts(new Command('install')));
  install
    .description('Run the inferred install plan (e.g. `npm install`, `pip install -r requirements.txt`).')
    .action(async (target: string, opts: { dryRun?: boolean; force?: boolean; offline?: boolean }) => {
      const scan = await scanProject({ root: target, offline: opts.offline });
      const steps = scan.installPlan.steps;
      if (steps.length === 0) {
        logger.warn('No install plan could be generated for this project.');
        logger.warn('Run `pst explain` to see why, or `pst detect` to inspect the scan.');
        process.exitCode = 2;
        return;
      }
      const { anyFailed } = await executeSequence(steps, {
        cwd: scan.root,
        dryRun: !!opts.dryRun,
        force: !!opts.force,
      });
      if (anyFailed) process.exitCode = 1;
    });

  // ---- pst run -------------------------------------------------------
  const run = withExecOpts(withStandardOpts(new Command('run')));
  run
    .description('Run the project using the inferred run command (e.g. `npm run dev`, `python main.py`).')
    .action(async (target: string, opts: { dryRun?: boolean; force?: boolean; offline?: boolean }) => {
      const scan = await scanProject({ root: target, offline: opts.offline });
      const steps = scan.runPlan.steps;
      if (steps.length === 0) {
        logger.warn('No run plan could be generated for this project.');
        logger.warn('This may be a library, or no entrypoint was found. Run `pst explain` for details.');
        process.exitCode = 2;
        return;
      }
      const { anyFailed } = await executeSequence(steps, {
        cwd: scan.root,
        dryRun: !!opts.dryRun,
        force: !!opts.force,
      });
      if (anyFailed) process.exitCode = 1;
    });

  // ---- pst build -----------------------------------------------------
  const build = withExecOpts(withStandardOpts(new Command('build')));
  build
    .description('Run the inferred build command (e.g. `npm run build`, `go build`).')
    .action(async (target: string, opts: { dryRun?: boolean; force?: boolean; offline?: boolean }) => {
      const scan = await scanProject({ root: target, offline: opts.offline });
      const steps = scan.buildPlan.steps;
      if (steps.length === 0) {
        logger.warn('No build plan could be generated. This project may not require a build step.');
        logger.warn('Run `pst explain` to see the full scan.');
        process.exitCode = 2;
        return;
      }
      const { anyFailed } = await executeSequence(steps, {
        cwd: scan.root,
        dryRun: !!opts.dryRun,
        force: !!opts.force,
      });
      if (anyFailed) process.exitCode = 1;
    });

  // ---- pst test ------------------------------------------------------
  const test = withExecOpts(withStandardOpts(new Command('test')));
  test
    .description('Run the inferred test command (e.g. `npm test`, `pytest`, `go test ./...`).')
    .action(async (target: string, opts: { dryRun?: boolean; force?: boolean; offline?: boolean }) => {
      const scan = await scanProject({ root: target, offline: opts.offline });
      const steps = scan.testPlan.steps;
      if (steps.length === 0) {
        logger.warn('No test plan could be generated. No test runner was detected.');
        logger.warn('Run `pst explain` to see the full scan.');
        process.exitCode = 2;
        return;
      }
      const { anyFailed } = await executeSequence(steps, {
        cwd: scan.root,
        dryRun: !!opts.dryRun,
        force: !!opts.force,
      });
      if (anyFailed) process.exitCode = 1;
    });

  // ---- pst deploy ----------------------------------------------------
  const deploy = withStandardOpts(new Command('deploy'));
  deploy
    .description('Print or run the inferred deploy plan. Defaults to dry-run for safety.')
    .option('-n, --dry-run', 'Print commands without executing (this is the default)')
    .option('-y, --force', 'Skip confirmation prompts AND actually execute the deploy')
    .option('-f, --format <fmt>', 'Output format for the printed plan: text, json, markdown', 'text')
    .action(async (target: string, opts: { dryRun?: boolean; force?: boolean; format: string; offline?: boolean }) => {
      const scan = await scanProject({ root: target, offline: opts.offline });
      const fmt = normalizeFormat(opts.format);
      // Always print the deploy plan first.
      const filtered = filterPlans(scan, 'deploy');
      const report = renderReport(filtered, fmt);
      process.stdout.write(report.content + '\n');

      if (scan.deployPlan.steps.length === 0) {
        logger.warn('No deploy command inferred. See notes in the plan above.');
        return;
      }
      // Deploy defaults to dry-run. Only execute if --force is explicitly set.
      // --dry-run is accepted for symmetry with other commands but is a no-op
      // here (it's already the default).
      if (!opts.force) {
        logger.info(chalk.gray('Dry-run mode (deploy defaults to dry-run for safety).'));
        logger.info(chalk.gray('Pass --force to actually execute the deploy plan.'));
        return;
      }
      const { anyFailed } = await executeSequence(scan.deployPlan.steps, {
        cwd: scan.root,
        dryRun: false,
        force: true,
      });
      if (anyFailed) process.exitCode = 1;
    });

  // ---- pst doctor ----------------------------------------------------
  const doctor = withStandardOpts(new Command('doctor'));
  doctor
    .description('Check that the local runtime can satisfy the detected stack.')
    .action(async (target: string, opts: { offline?: boolean }) => {
      const scan = await scanProject({ root: target, offline: opts.offline });
      const requiredBinaries = new Set<string>();
      for (const pm of scan.packageManagers) {
        requiredBinaries.add(pm.binary.split(' ')[0]);
      }
      for (const lang of scan.languages) {
        if (lang.id === 'node') requiredBinaries.add('node');
        if (lang.id === 'python') requiredBinaries.add('python3');
        if (lang.id === 'go') requiredBinaries.add('go');
        if (lang.id === 'docker') requiredBinaries.add('docker');
      }

      logger.info(chalk.bold('PST doctor — runtime check'));
      logger.info(chalk.gray(`Project: ${scan.root}`));
      if (opts.offline) {
        logger.info(chalk.gray('Mode:    offline (binary checks skipped)'));
        logger.info('');
        // Still print diagnostics — those don't require binary probes.
      } else {
        logger.info('');
        const checks: Array<{ bin: string; found: boolean; version: string | null; path: string | null }> = [];
        for (const bin of requiredBinaries) {
          const binPath = await which(bin);
          const ver = binPath ? await versionOf(bin) : null;
          checks.push({ bin, found: !!binPath, version: ver, path: binPath });
        }
        for (const c of checks) {
          const icon = c.found ? chalk.green('✓') : chalk.red('✗');
          const ver = c.version ? chalk.gray(` (v${c.version})`) : '';
          const where = c.path ? chalk.gray(` — ${c.path}`) : '';
          logger.info(`  ${icon} ${c.bin}${ver}${where}`);
        }
        const missing = checks.filter((c) => !c.found);
        if (missing.length > 0) {
          logger.info('');
          logger.info(chalk.bold('Missing binaries'));
          for (const m of missing) {
            logger.info(`  ${chalk.red('✗')} ${m.bin} — install before running the plan`);
          }
        }
      }

      // Environment file check (always runs — file-based, not network)
      const exampleEnv = scan.env.filter((e) => e.kind === 'example').map((e) => e.path);
      if (exampleEnv.length > 0) {
        logger.info('');
        logger.info(chalk.bold('Environment files'));
        for (const p of exampleEnv) {
          logger.info(`  ${chalk.yellow('!')} ${p} — copy to .env and fill in values before running`);
        }
      }

      // Diagnostics
      const errs = scan.diagnostics.filter((d) => d.severity === 'error');
      const warns = scan.diagnostics.filter((d) => d.severity === 'warn');
      logger.info('');
      logger.info(chalk.bold('Diagnostics'));
      if (errs.length + warns.length === 0) {
        logger.info(chalk.green('  No issues detected.'));
      } else {
        for (const d of scan.diagnostics) {
          if (d.severity === 'info') continue; // keep doctor output focused on actionable issues
          const icon = d.severity === 'error' ? chalk.red('✗') : chalk.yellow('!');
          logger.info(`  ${icon} ${d.message}`);
          if (d.nextStep) logger.info(chalk.gray(`      fix: ${d.nextStep}`));
        }
      }

      if (errs.length > 0) {
        process.exitCode = 1;
      }
    });

  // ---- pst explain ---------------------------------------------------
  const explain = withStandardOpts(new Command('explain'));
  explain
    .description('Explain why PST inferred each detection and command, with confidence scores.')
    .option('--only <kind>', 'Explain only one plan: install, run, build, test, deploy')
    .action(async (target: string, opts: { only?: string; offline?: boolean }) => {
      const scan = await scanProject({ root: target, offline: opts.offline });
      logger.info(chalk.bold.cyan('PST explanation'));
      logger.info(chalk.gray(`Project: ${scan.root}`));
      logger.info(chalk.gray(`Overall confidence: ${scan.overall.level} (${scan.overall.score})`));
      logger.info('');

      logger.info(chalk.bold('Why we detected this stack'));
      for (const l of scan.languages) {
        logger.info(`  ${chalk.green('•')} ${l.name} — ${l.confidence.level} (${l.confidence.score})`);
        logger.info(chalk.gray(`      ${l.confidence.reason}`));
        logger.info(chalk.gray(`      evidence: ${l.evidence.join(', ')}`));
      }
      for (const pm of scan.packageManagers.slice(0, 1)) {
        logger.info(`  ${chalk.green('•')} ${pm.name} — ${pm.confidence.level}`);
        logger.info(chalk.gray(`      ${pm.confidence.reason}`));
      }
      logger.info('');

      type AnyPlan = { steps: Array<{ label: string; command: string; rationale: string; confidence: { level: string; score: number; reason: string } }>; notes: string[] };
      const sections: Array<[string, AnyPlan]> = [
        ['Install plan', scan.installPlan],
        ['Run plan', scan.runPlan],
        ['Build plan', scan.buildPlan],
        ['Test plan', scan.testPlan],
        ['Deploy plan', scan.deployPlan],
      ];
      for (const [title, plan] of sections) {
        if (opts.only && title.toLowerCase().indexOf(opts.only) < 0) continue;
        logger.info(chalk.bold(title));
        if (plan.steps.length === 0) {
          logger.info(chalk.gray('  (no steps)'));
        }
        for (const s of plan.steps) {
          logger.info(`  ${chalk.green('•')} ${s.label}`);
          logger.info(chalk.gray(`      $ ${s.command}`));
          logger.info(chalk.gray(`      why: ${s.rationale}`));
          logger.info(chalk.gray(`      confidence: ${s.confidence.level} (${s.confidence.score}) — ${s.confidence.reason}`));
        }
        for (const n of plan.notes) logger.info(chalk.gray(`  note: ${n}`));
        logger.info('');
      }

      if (scan.diagnostics.length > 0) {
        logger.info(chalk.bold('Diagnostics'));
        for (const d of scan.diagnostics) {
          const icon = d.severity === 'error' ? chalk.red('✗') : d.severity === 'warn' ? chalk.yellow('!') : chalk.blue('i');
          logger.info(`  ${icon} ${d.message}`);
          if (d.nextStep) logger.info(chalk.gray(`      fix: ${d.nextStep}`));
        }
      }
    });

  program.addCommand(detect);
  program.addCommand(inspect);
  program.addCommand(plan);
  program.addCommand(install);
  program.addCommand(run);
  program.addCommand(build);
  program.addCommand(test);
  program.addCommand(deploy);
  program.addCommand(doctor);
  program.addCommand(explain);

  // ---- pst plugins ---------------------------------------------------
  const pluginsCmd = new Command('plugins');
  pluginsCmd
    .description('Manage PST plugins (list, inspect, validate).')
    .argument('[path]', 'Project root (defaults to current directory)', '.');

  // pst plugins list
  const pluginsList = new Command('list');
  pluginsList
    .description('List all loaded plugins (built-in + config + auto-discovered).')
    .argument('[path]', 'Project root', '.')
    .option('--auto-discover', 'Scan node_modules for pst-plugin-X packages')
    .option('--json', 'Output as JSON')
    .action(async (target: string, opts: { autoDiscover?: boolean; json?: boolean }) => {
      const pm = new PluginManager({ root: target, autoDiscover: opts.autoDiscover });
      await pm.load();
      const list = pm.list();
      if (opts.json) {
        const out = list.map((lp) => ({
          id: lp.manifest.id,
          name: lp.manifest.name,
          version: lp.manifest.version,
          apiVersion: lp.manifest.apiVersion,
          pstRange: lp.manifest.pstRange,
          kinds: lp.manifest.kinds,
          source: lp.source,
          sourcePath: lp.sourcePath,
          failed: lp.failed,
          failureReason: lp.failureReason,
        }));
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        return;
      }
      logger.info(chalk.bold('PST plugins'));
      logger.info(chalk.gray(`Project: ${path.resolve(target)}\n`));
      if (list.length === 0) {
        logger.info(chalk.gray('  No plugins loaded.'));
        return;
      }
      for (const lp of list) {
        const status = lp.failed ? chalk.red('✗') : chalk.green('✓');
        const src = chalk.gray(`(${lp.source})`);
        const failed = lp.failed ? chalk.red(` [FAILED: ${lp.failureReason}]`) : '';
        logger.info(`  ${status} ${chalk.bold(lp.manifest.id)} ${chalk.gray(`v${lp.manifest.version}`)} ${src}${failed}`);
        logger.info(chalk.gray(`      name:  ${lp.manifest.name}`));
        logger.info(chalk.gray(`      kinds: ${lp.manifest.kinds.join(', ')}`));
        logger.info(chalk.gray(`      range: ${lp.manifest.pstRange}  (api: ${lp.manifest.apiVersion})`));
        if (lp.manifest.owns && lp.manifest.owns.length > 0) {
          logger.info(chalk.gray(`      owns:  ${lp.manifest.owns.join(', ')}`));
        }
      }
    });

  // pst plugins inspect
  const pluginsInspect = new Command('inspect');
  pluginsInspect
    .description('Show detailed information about a single plugin.')
    .argument('<id>', 'Plugin id (e.g. "node", "rust", "@my-org/my-plugin")')
    .argument('[path]', 'Project root', '.')
    .option('--auto-discover', 'Scan node_modules for pst-plugin-X packages')
    .action(async (id: string, target: string, opts: { autoDiscover?: boolean }) => {
      const pm = new PluginManager({ root: target, autoDiscover: opts.autoDiscover });
      await pm.load();
      const lp = pm.inspect(id);
      if (!lp) {
        logger.error(`Plugin "${id}" not found.`);
        logger.error('Run `pst plugins list` to see loaded plugins.');
        process.exitCode = 1;
        return;
      }
      logger.info(chalk.bold(`Plugin: ${lp.manifest.id}`));
      logger.info(chalk.gray(`Source: ${lp.source} (${lp.sourcePath})`));
      logger.info('');
      logger.info(`  name:       ${lp.manifest.name}`);
      logger.info(`  version:    ${lp.manifest.version}`);
      logger.info(`  apiVersion: ${lp.manifest.apiVersion}`);
      logger.info(`  pstRange:   ${lp.manifest.pstRange}`);
      logger.info(`  kinds:      ${lp.manifest.kinds.join(', ')}`);
      if (lp.manifest.owns && lp.manifest.owns.length > 0) {
        logger.info(`  owns:       ${lp.manifest.owns.join(', ')}`);
      }
      if (lp.manifest.description) logger.info(`  description: ${lp.manifest.description}`);
      if (lp.manifest.author) logger.info(`  author:     ${lp.manifest.author}`);
      if (lp.manifest.homepage) logger.info(`  homepage:   ${lp.manifest.homepage}`);
      logger.info(`  status:     ${lp.failed ? chalk.red('FAILED') : chalk.green('OK')}`);
      if (lp.failureReason) logger.info(chalk.red(`  reason:     ${lp.failureReason}`));
    });

  // pst plugins validate
  const pluginsValidate = new Command('validate');
  pluginsValidate
    .description('Validate all loaded plugins (check API version, PST range, manifest).')
    .argument('[path]', 'Project root', '.')
    .option('--auto-discover', 'Scan node_modules for pst-plugin-X packages')
    .action(async (target: string, opts: { autoDiscover?: boolean }) => {
      const pm = new PluginManager({ root: target, autoDiscover: opts.autoDiscover });
      await pm.load();
      const list = pm.list();
      let failed = 0;
      let ok = 0;
      for (const lp of list) {
        if (lp.failed) {
          failed++;
          logger.error(`${chalk.red('✗')} ${lp.manifest.id} — ${lp.failureReason}`);
        } else {
          ok++;
          logger.info(`${chalk.green('✓')} ${lp.manifest.id} (api v${lp.manifest.apiVersion}, pst ${lp.manifest.pstRange})`);
        }
      }
      logger.info('');
      logger.info(chalk.bold(`Summary: ${ok} valid, ${failed} failed`));
      if (failed > 0) process.exitCode = 1;
    });

  pluginsCmd.addCommand(pluginsList);
  pluginsCmd.addCommand(pluginsInspect);
  pluginsCmd.addCommand(pluginsValidate);
  program.addCommand(pluginsCmd);

  // ---- pst topology --------------------------------------------------
  const topology = new Command('topology');
  topology
    .description('Analyze a monorepo workspace: detect packages, build dependency graph, compute build order.')
    .argument('[path]', 'Project root (defaults to current directory)', '.')
    .option('-f, --format <fmt>', 'Output format: text, json, markdown, dot', 'text')
    .option('--offline', 'Skip runtime binary presence checks')
    .action(async (target: string, opts: { format: string; offline?: boolean }) => {
      const { buildWorkspaceGraph, buildWorkspaceScanResult, renderTopology } = await import('../workspace/index.js');
      const graph = await buildWorkspaceGraph(target);
      const scan = buildWorkspaceScanResult(graph);
      const fmt = opts.format === 'dot' ? 'dot' : opts.format === 'json' ? 'json' : opts.format === 'markdown' || opts.format === 'md' ? 'markdown' : 'text';
      const output = renderTopology(scan, fmt as 'text' | 'json' | 'markdown' | 'dot');
      process.stdout.write(output + '\n');
      if (scan.diagnostics.some((d) => d.severity === 'error')) {
        process.exitCode = 1;
      }
    });

  // ---- pst graph -----------------------------------------------------
  const graph = new Command('graph');
  graph
    .description('Print the workspace dependency graph (defaults to Graphviz DOT format).')
    .argument('[path]', 'Project root', '.')
    .option('-f, --format <fmt>', 'Output format: dot, json, text', 'dot')
    .action(async (target: string, opts: { format: string }) => {
      const { buildWorkspaceGraph, buildWorkspaceScanResult, renderTopology } = await import('../workspace/index.js');
      const g = await buildWorkspaceGraph(target);
      const scan = buildWorkspaceScanResult(g);
      const fmt = opts.format === 'json' ? 'json' : opts.format === 'text' ? 'text' : 'dot';
      const output = renderTopology(scan, fmt as 'text' | 'json' | 'dot');
      process.stdout.write(output + '\n');
    });

  // ---- pst workspace -------------------------------------------------
  const workspaceCmd = new Command('workspace');
  workspaceCmd
    .description('Workspace intelligence commands for monorepos.');

  const workspaceInspect = new Command('inspect');
  workspaceInspect
    .description('Inspect a single workspace package in detail.')
    .argument('<packageId>', 'Package id or name (e.g. "apps/web" or "@my-org/ui")')
    .argument('[path]', 'Project root', '.')
    .option('-f, --format <fmt>', 'Output format: text, json', 'text')
    .action(async (packageId: string, target: string, opts: { format: string }) => {
      const { buildWorkspaceGraph, buildWorkspaceScanResult } = await import('../workspace/index.js');
      const g = await buildWorkspaceGraph(target);
      const scan = buildWorkspaceScanResult(g);
      // Find by id or name
      const node = scan.nodes.find((n) => n.id === packageId || n.name === packageId);
      if (!node) {
        logger.error(`Package "${packageId}" not found in workspace.`);
        logger.error('Available packages:');
        for (const n of scan.nodes) {
          if (n.type === 'root') continue;
          logger.error(`  ${n.name} (${n.path})`);
        }
        process.exitCode = 1;
        return;
      }
      if (opts.format === 'json') {
        process.stdout.write(JSON.stringify(node, null, 2) + '\n');
        return;
      }
      logger.info(chalk.bold(`Package: ${node.name}`));
      logger.info(chalk.gray(`Path: ${node.path}`));
      logger.info(chalk.gray(`Type: ${node.type}`));
      logger.info(`  language:     ${node.language?.name ?? 'unknown'}`);
      logger.info(`  runnable:     ${node.runnable ? 'yes' : 'no'}`);
      logger.info(`  ext deps:     ${node.externalDependencyCount}`);
      logger.info(`  scripts:      ${node.scripts.join(', ') || '(none)'}`);
      if (node.workspaceDependencies.length > 0) {
        logger.info(`  ws deps:      ${node.workspaceDependencies.join(', ')}`);
      }
      // What depends on this package?
      const dependents = scan.edges.filter((e) => e.to === node.id).map((e) => e.from);
      if (dependents.length > 0) {
        const depNames = dependents.map((id) => scan.nodes.find((n) => n.id === id)?.name).filter(Boolean);
        logger.info(`  depended on:  ${depNames.join(', ')}`);
      } else if (node.type !== 'app' && node.type !== 'service') {
        logger.info(chalk.gray(`  depended on:  (nothing — orphan package)`));
      }
    });

  workspaceCmd.addCommand(workspaceInspect);
  program.addCommand(workspaceCmd);
  program.addCommand(topology);
  program.addCommand(graph);

  return program;
}

function normalizeFormat(fmt: string): 'text' | 'json' | 'markdown' {
  if (fmt === 'json') return 'json';
  if (fmt === 'markdown' || fmt === 'md') return 'markdown';
  return 'text';
}

function filterPlans(scan: ProjectScanResult, only?: string): ProjectScanResult {
  if (!only) return scan;
  const kinds = new Set(only.split(',').map((s) => s.trim().toLowerCase()));
  const out: ProjectScanResult = { ...scan };
  if (!kinds.has('install')) out.installPlan = { ...scan.installPlan, steps: [] };
  if (!kinds.has('run')) out.runPlan = { ...scan.runPlan, steps: [] };
  if (!kinds.has('build')) out.buildPlan = { ...scan.buildPlan, steps: [] };
  if (!kinds.has('test')) out.testPlan = { ...scan.testPlan, steps: [] };
  if (!kinds.has('deploy')) out.deployPlan = { ...scan.deployPlan, steps: [] };
  return out;
}
