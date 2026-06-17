/**
 * pst-plugin-rust — planner module (reference implementation).
 *
 * Generates install/run/build/test/deploy plans for Rust projects.
 * Applies only when Rust is the primary detected language.
 */

import { conf, definePlannerPlugin, PLUGIN_API_VERSION } from 'pst-cli/plugin-api';
import type { PlannerInput, PlannerOutput, PluginContext } from 'pst-cli/plugin-api';

export default definePlannerPlugin({
  manifest: {
    id: 'rust-planner',
    name: 'Rust planner',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    pstRange: '>=0.1.0',
    kinds: ['planner'],
    owns: ['rust'],
    description: 'Generates cargo build/run/test plans for Rust projects.',
  },

  async appliesTo(input: PlannerInput): Promise<boolean> {
    return input.languages[0]?.id === ('rust' as never);
  },

  async plan(input: PlannerInput, _ctx: PluginContext): Promise<PlannerOutput> {
    const pm = input.packageManagers[0];
    if (!pm || pm.id !== ('cargo' as never)) {
      return { diagnostics: [] };
    }

    const requiredEnv = new Set<string>();
    for (const e of input.env) {
      if (e.kind === 'example') {
        for (const v of e.variables) {
          if (v.required) requiredEnv.add(v.name);
        }
      }
    }

    const entrypoint = input.entrypoints[0];

    return {
      installPlan: {
        steps: [
          {
            label: 'Fetch dependencies',
            command: 'cargo fetch',
            rationale: 'Download all crate dependencies without building',
            confidence: conf(0.9, 'cargo convention'),
          },
        ],
        packageManager: 'cargo',
        notes: [],
      },
      buildPlan: {
        steps: [
          {
            label: 'Build (release)',
            command: 'cargo build --release',
            rationale: 'Standard cargo build invocation (release profile)',
            confidence: conf(0.9, 'cargo convention'),
          },
        ],
        output: 'target/release/<binary>',
        notes: [],
      },
      runPlan: entrypoint
        ? {
            steps: [
              {
                label: 'Run app',
                command: 'cargo run',
                rationale: `Found entrypoint ${entrypoint}`,
                requiredEnv: Array.from(requiredEnv),
                confidence: conf(0.9, 'cargo run convention'),
              },
            ],
            entrypoint,
            notes: [],
          }
        : {
            steps: [],
            notes: ['No src/main.rs found — this appears to be a library crate.'],
          },
      testPlan: {
        steps: [
          {
            label: 'Run tests',
            command: 'cargo test',
            rationale: 'Standard cargo test invocation',
            confidence: conf(0.9, 'cargo convention'),
          },
        ],
        notes: [],
      },
      deployPlan: {
        steps: [],
        targets: ['generic-host'],
        readiness: 'not-ready',
        notes: ['Rust binaries deploy to any Linux host. Add a Dockerfile for portable deploys.'],
      },
    };
  },
});
