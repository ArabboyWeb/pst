/**
 * Plugin pipeline benchmarks.
 *
 * Measures the overhead of the plugin system compared to direct detector
 * calls. Run with:
 *
 *   node scripts/benchmark-plugins.js
 *
 * The benchmark compares:
 *   1. Direct detector calls (pre-migration baseline)
 *   2. Plugin-pipeline scan (current architecture)
 *
 * Acceptance criteria: plugin pipeline should add < 50ms overhead per scan
 * for a typical project.
 */

import { scanProject } from '../dist/index.js';
import { PluginManager } from '../dist/index.js';
import path from 'node:path';

const FIXTURE = path.resolve('fixtures/node-app');
const ITERATIONS = 20;

async function bench(name, fn) {
  // Warmup
  for (let i = 0; i < 3; i++) await fn();

  const times = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const min = times[0];
  const max = times[times.length - 1];
  console.log(`${name.padEnd(45)} median=${median.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  min=${min.toFixed(1)}ms  max=${max.toFixed(1)}ms`);
}

async function main() {
  console.log(`PST Plugin Pipeline Benchmark (${ITERATIONS} iterations)\n`);

  // 1. Full scan via plugin pipeline
  await bench('scanProject (plugin pipeline, offline)', async () => {
    await scanProject({ root: FIXTURE, offline: true });
  });

  // 2. Plugin load only (no scan)
  await bench('PluginManager.load (built-in only)', async () => {
    const pm = new PluginManager({ root: FIXTURE });
    await pm.load();
  });

  // 3. Plugin load + initialize + detect
  await bench('PluginManager load+init+detect', async () => {
    const pm = new PluginManager({ root: FIXTURE });
    await pm.load();
    const diagnostics = [];
    await pm.initializeAll(FIXTURE, [], new Set(), diagnostics);
    await pm.runDetectors(FIXTURE, [], diagnostics);
    await pm.shutdownAll();
  });

  // 4. Scan with extra plugin (Rust)
  const rustDetector = path.resolve('plugins/rust/detector.ts');
  const rustPlanner = path.resolve('plugins/rust/planner.ts');
  await bench('scanProject + rust plugin (offline)', async () => {
    await scanProject({
      root: 'fixtures/plugin-projects/rust-app',
      offline: true,
      pluginPaths: [rustDetector, rustPlanner],
    });
  });

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
