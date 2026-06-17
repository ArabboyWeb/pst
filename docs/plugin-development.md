# Plugin Development Guide

This guide explains how to write, publish, and distribute PST plugins. PST is
plugin-driven: even the built-in Node, Python, Go, and Docker support runs
through the same plugin API you'll use here.

## Table of contents

- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Plugin kinds](#plugin-kinds)
- [Plugin lifecycle](#plugin-lifecycle)
- [Plugin manifest](#plugin-manifest)
- [Writing a detector plugin](#writing-a-detector-plugin)
- [Writing a planner plugin](#writing-a-planner-plugin)
- [Loading plugins](#loading-plugins)
- [Isolation and error handling](#isolation-and-error-handling)
- [Versioning and compatibility](#versioning-and-compatibility)
- [Publishing](#publishing)
- [Reference: pst-plugin-rust](#reference-pst-plugin-rust)
- [Testing your plugin](#testing-your-plugin)

---

## Architecture

```
                    ┌──────────────────────────────────────┐
                    │            PST Core (CLI)             │
                    │  detect / plan / install / run / ...  │
                    └─────────────────┬────────────────────┘
                                      │
                                      ▼
                    ┌──────────────────────────────────────┐
                    │          PluginManager                │
                    │  load → initialize → run → shutdown   │
                    └─────────────────┬────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              ┌──────────┐     ┌──────────┐     ┌──────────────┐
              │ Built-in │     │  Config  │     │ Auto-discover │
              │ plugins  │     │ plugins  │     │   (opt-in)    │
              │          │     │          │     │               │
              │ node     │     │ pst.     │     │ pst-plugin-*  │
              │ python   │     │ config.  │     │ @*/pst-plugin-*│
              │ go       │     │ json     │     │               │
              │ docker   │     │          │     │               │
              │ planner  │     │          │     │               │
              └──────────┘     └──────────┘     └───────────────┘
```

PST core never calls detectors or planners directly. Everything flows through
the PluginManager. Built-in plugins are registered in
`src/plugins/builtin-registry.ts` and are loaded with the same pipeline as
third-party plugins.

## Quick start

The fastest way to start is to copy the reference Rust plugin:

```sh
cp -r plugins/rust my-plugin
```

Then edit `my-plugin/detector.ts`:

```ts
import { defineDetectorPlugin, conf, PLUGIN_API_VERSION } from 'pst-cli/plugin-api';
import type { DetectorResult, PluginContext } from 'pst-cli/plugin-api';

export default defineDetectorPlugin({
  manifest: {
    id: 'my-lang',
    name: 'My Language',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    pstRange: '>=0.1.0',
    kinds: ['detector'],
    owns: ['my-lang'],
  },
  async detect(ctx: PluginContext): Promise<DetectorResult> {
    const manifestFile = ctx.allFiles.find((f) => f === 'my-lang.toml');
    if (!manifestFile) return { languages: [], frameworks: [], packageManagers: [], manifests: [], files: [], env: [], entrypoints: [] };

    // ... detect your language, framework, package manager, etc.
    return {
      languages: [{
        id: 'my-lang' as never,
        name: 'My Language',
        evidence: [manifestFile],
        confidence: conf(0.95, `Found ${manifestFile}`),
      }],
      // ... fill in the rest
    };
  },
});
```

Test it:

```sh
pst detect . --plugin ./my-plugin/detector.ts
```

## Plugin kinds

A plugin can implement one or more of these kinds:

| Kind                | Interface           | Purpose                                         |
| ------------------- | ------------------- | ----------------------------------------------- |
| `detector`          | `DetectorPlugin`    | Identify languages, frameworks, PMs, manifests   |
| `framework-detector`| `DetectorPlugin`    | Framework-level detection (same interface)       |
| `planner`           | `PlannerPlugin`     | Generate install/run/build/test/deploy plans     |
| `installer`         | `InstallerPlugin`   | Execute install commands (replaces default)      |
| `runner`            | `RunnerPlugin`      | Execute run commands                             |
| `deployer`          | `DeployerPlugin`    | Execute deploy commands                          |

Most plugins implement `detector` and/or `planner`. The `installer`/`runner`/
`deployer` kinds are for plugins that need custom execution (e.g. installing
via Nix, running inside a devcontainer, deploying to a specific platform).

## Plugin lifecycle

```
load()           → Plugin is discovered and its manifest is validated
  ↓
initialize()     → Called once when the plugin is loaded (optional)
  ↓
detect() / plan() → Called per scan (may be called multiple times)
  ↓
shutdown()       → Called once when PST shuts down (optional)
```

- `initialize()` is for one-time setup: opening connections, loading caches,
  validating the environment. It has a 5-second timeout.
- `detect()` / `plan()` are called per scan. They have a 10-second timeout.
- `shutdown()` is for cleanup: closing connections, flushing buffers. It has
  a 5-second timeout.
- `validate()` is optional: it checks whether the plugin can satisfy its
  claims (e.g. is the required binary installed?). PST calls it during
  `pst plugins validate`.

All lifecycle methods are wrapped in error boundaries. If your plugin throws,
PST catches the error, emits a diagnostic, and continues. Your plugin failure
never crashes PST.

## Plugin manifest

Every plugin declares a manifest:

```ts
interface PluginManifest {
  id: string;            // Globally unique, e.g. "rust" or "@my-org/rust"
  name: string;          // Human-facing name
  version: string;       // Plugin semver
  apiVersion: 1;         // Must equal PLUGIN_API_VERSION (currently 1)
  pstRange: string;      // Semver range of PST versions, e.g. ">=0.1.0"
  kinds: PluginKind[];   // What this plugin implements
  description?: string;  // Short description
  author?: string;
  homepage?: string;
  owns?: string[];       // Language/framework ids this plugin claims
}
```

The `owns` field is used for conflict resolution. If two plugins claim the
same id, the higher-priority one (config > local > auto-discovered > builtin)
wins, and PST emits a diagnostic for the loser.

## Writing a detector plugin

A detector identifies what's in the project. It returns a `DetectorResult`
with any of: languages, frameworks, package managers, manifests, files, env
files, and entrypoints.

```ts
import { defineDetectorPlugin, conf, PLUGIN_API_VERSION } from 'pst-cli/plugin-api';
import type { DetectorResult, PluginContext } from 'pst-cli/plugin-api';

export default defineDetectorPlugin({
  manifest: {
    id: 'my-lang',
    name: 'My Language',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    pstRange: '>=0.1.0',
    kinds: ['detector'],
    owns: ['my-lang'],
  },
  async initialize(ctx: PluginContext) {
    // Optional: one-time setup
    ctx.log.debug('My plugin initializing');
  },
  async detect(ctx: PluginContext): Promise<DetectorResult> {
    // ctx.root — absolute path to project root
    // ctx.allFiles — relative paths of all files in the project
    // ctx.claimedFiles — files already claimed by other plugins
    // ctx.diagnostics — push warnings/errors here
    // ctx.log — scoped logger

    const manifestFile = ctx.allFiles.find((f) => f === 'my-lang.toml');
    if (!manifestFile) {
      return { languages: [], frameworks: [], packageManagers: [], manifests: [], files: [], env: [], entrypoints: [] };
    }

    // Claim the file so other plugins don't double-process it
    ctx.claimedFiles.add(manifestFile);

    return {
      languages: [{
        id: 'my-lang' as never,
        name: 'My Language',
        evidence: [manifestFile],
        confidence: conf(0.95, `Found ${manifestFile}`),
      }],
      packageManagers: [{
        id: 'my-pm' as never,
        name: 'My PM',
        lockfiles: [],
        manifests: [manifestFile],
        binary: 'my-pm',
        confidence: conf(0.9, 'my-lang.toml present'),
      }],
      manifests: [{
        kind: 'my-lang.toml' as never,
        path: manifestFile,
        evidence: [manifestFile],
      }],
      files: [{
        path: manifestFile,
        kind: 'manifest',
        note: 'My Language manifest',
      }],
      frameworks: [],
      env: [],
      entrypoints: [],
    };
  },
  async shutdown() {
    // Optional: cleanup
  },
});
```

### Detection guidelines

- **Only detect root-level manifests** for primary language detection.
  Subdirectory manifests should be recorded as files but not trigger primary
  language claims. This prevents test fixtures from hijacking detection.
- **Use `ctx.claimedFiles`** to avoid double-processing.
- **Push diagnostics** for anything unusual (malformed manifest, missing
  lockfile, etc.).
- **Never throw** — wrap failures in diagnostics. PST will catch exceptions,
  but pushing diagnostics gives users better messages.
- **Be honest about confidence**. If you're guessing, score it 0.4-0.6. If
  you have strong evidence (lockfile present + manifest parsed + binary
  found), score it 0.9+.

## Writing a planner plugin

A planner converts detection results into concrete commands.

```ts
import { definePlannerPlugin, conf, PLUGIN_API_VERSION } from 'pst-cli/plugin-api';
import type { PlannerInput, PlannerOutput, PluginContext } from 'pst-cli/plugin-api';

export default definePlannerPlugin({
  manifest: {
    id: 'my-lang-planner',
    name: 'My Language planner',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    pstRange: '>=0.1.0',
    kinds: ['planner'],
    owns: ['my-lang'],
  },
  async appliesTo(input: PlannerInput): Promise<boolean> {
    // Only run when my-lang is the primary language
    return input.languages[0]?.id === ('my-lang' as never);
  },
  async plan(input: PlannerInput, ctx: PluginContext): Promise<PlannerOutput> {
    return {
      installPlan: {
        steps: [{
          label: 'Install dependencies',
          command: 'my-pm install',
          rationale: 'my-lang.toml present',
          confidence: conf(0.9, 'my-pm convention'),
        }],
        packageManager: 'my-pm',
        notes: [],
      },
      runPlan: { steps: [], notes: [] },
      buildPlan: { steps: [], notes: [] },
      testPlan: { steps: [], notes: [] },
      deployPlan: { steps: [], targets: ['generic-host'], readiness: 'not-ready', notes: [] },
    };
  },
});
```

### Planner precedence

When multiple planner plugins apply, PST uses this precedence (highest first):

1. **Config plugins** (declared in `pst.config.json`)
2. **Local plugins** (passed via `--plugin`)
3. **Auto-discovered plugins** (from `node_modules`, opt-in)
4. **Built-in planner** (always last resort — handles Node/Python/Go/Docker)

The first applicable planner wins. Third-party planners take precedence over
the built-in planner, so a Rust planner will fire before the built-in planner
even checks for Node/Python/Go/Docker.

## Loading plugins

### Via pst.config.json (recommended for projects)

Create `pst.config.json` at your project root:

```json
{
  "plugins": [
    "pst-plugin-rust",
    "./plugins/my-local-plugin.ts"
  ]
}
```

- Entries starting with `./` or `/` are loaded as local files.
- Other entries are loaded as npm packages (resolved from your project's
  `node_modules`).

### Via CLI flag (for one-off use)

```sh
pst detect . --plugin ./plugins/my-plugin.ts
```

(This flag is not yet wired in the MVP; plugins are loaded via config or
ScanOptions for now.)

### Via auto-discovery (opt-in)

```sh
pst detect . --auto-discover-plugins
```

PST scans `node_modules` for packages named `pst-plugin-*` or
`@scope/pst-plugin-*` and loads them all. This is off by default because
scanning `node_modules` is slow on large projects.

## Isolation and error handling

Every plugin call is wrapped in an error boundary + timeout:

| Method         | Timeout | On error                          |
| -------------- | ------- | --------------------------------- |
| `initialize()` | 5s      | Plugin marked failed; diagnostic  |
| `detect()`     | 10s     | Empty result; diagnostic           |
| `plan()`       | 10s     | null (planner skipped); diagnostic |
| `validate()`   | 5s      | ok: false; diagnostic              |
| `shutdown()`   | 5s      | Ignored                            |

A failed plugin never crashes PST. Other plugins continue to run normally.

## Versioning and compatibility

### API version

The `apiVersion` field in your manifest must equal `PLUGIN_API_VERSION`
(currently `1`). PST refuses to load plugins with a different apiVersion.

When the plugin API changes in a backwards-incompatible way, PST will bump
to `PLUGIN_API_VERSION = 2` and support both during a transition window.

### PST version range

The `pstRange` field is a semver range (e.g. `^1.0.0`, `>=0.1.0`). PST
validates it against its own version before loading. If the range doesn't
match, PST marks the plugin as failed and emits a diagnostic.

Supported range syntax: `^1.0.0`, `~1.2.3`, `>=1.0.0`, `<=2.0.0`, `>1.0.0`,
`<2.0.0`, `=1.0.0`, exact `1.0.0`, `*`, and compound `>=1.0.0 <2.0.0`.

## Publishing

### Package naming

Use one of these naming conventions so PST can auto-discover your plugin:

- `pst-plugin-rust` (unscoped)
- `@your-org/pst-plugin-rust` (scoped)

### package.json

```json
{
  "name": "pst-plugin-rust",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "peerDependencies": {
    "pst-cli": ">=0.1.0"
  },
  "files": ["dist", "README.md"]
}
```

### Build

Use `tsup` or `tsc` to compile to ESM. Your plugin's default export must be
a plugin object (or an object with a `plugin` named export, or the module
itself must be the plugin).

### Publishing

```sh
npm publish
```

Users install your plugin in their project:

```sh
npm install pst-plugin-rust
```

And add it to their `pst.config.json`:

```json
{
  "plugins": ["pst-plugin-rust"]
}
```

## Reference: pst-plugin-rust

The `plugins/rust/` directory contains a complete reference implementation.
It adds Rust support to PST without modifying core:

- `plugins/rust/detector.ts` — detects Rust via Cargo.toml
- `plugins/rust/planner.ts` — generates `cargo fetch` / `cargo build` /
  `cargo run` / `cargo test` plans

Test it:

```sh
pst detect fixtures/plugin-projects/rust-app \
  --plugin plugins/rust/detector.ts \
  --plugin plugins/rust/planner.ts
```

(CLI `--plugin` flag is pending; for now use the `pluginPaths` option in
`ScanOptions` or `pst.config.json`.)

## Testing your plugin

Write a test that loads your plugin and runs it against a fixture:

```ts
import { PluginManager } from 'pst-cli';

const pm = new PluginManager({
  root: 'fixtures/my-app',
  skipBuiltin: true,
  extraPaths: ['./plugins/my-lang/detector.ts'],
});
await pm.load();
const result = await pm.runDetectors('fixtures/my-app', ['my-lang.toml'], []);
expect(result.languages[0].id).toBe('my-lang' as never);
```

Use the test plugins in `fixtures/test-plugins/` as templates:
- `mock.ts` — a minimal working plugin
- `failing.ts` — a plugin whose `detect()` throws (tests isolation)
- `timeout.ts` — a plugin that hangs (tests timeout protection)
- `incompatible.ts` — a plugin with wrong apiVersion (tests version checks)
- `bad-manifest.ts` — a plugin with no manifest (tests manifest validation)

## Next steps

- Read the source: `src/plugin-api/index.ts` for the full type definitions
- Read `src/plugins/loader.ts` for the loading and isolation logic
- Read `src/plugins/builtin-registry.ts` for how built-in plugins are wrapped
- File issues at https://github.com/ArabboyWeb/pst/issues
