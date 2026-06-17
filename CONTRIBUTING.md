# Contributing to PST

Thanks for your interest in improving PST! This guide covers the basics.

## Quick start

```sh
git clone https://github.com/ArabboyWeb/pst.git
cd pst
npm install
npm run build
npm test
```

All three should pass before you open a PR:

```sh
npm run lint     # tsc --noEmit
npm run build    # tsup
npm test         # vitest
```

## First-time setup gotcha

If `git pull` fails with a `package-lock.json` conflict after running `npm install`,
run:

```sh
git stash && git pull && git stash pop && npm install
```

## Safety contract — read this first

PST has a strict safety contract that must not be weakened:

1. **Never weaken the executor blocklist.** If you need to add an exception,
   open an issue first and explain why.
2. **Never remove the non-interactive guard.** If stdin is not a TTY and
   `--force` is not set, PST must refuse to execute.
3. **Never auto-edit user files.** PST only suggests commands; the user runs
   them.
4. **Never raise confidence without evidence.** If you bump a score, you
   must add a test that proves the new score is warranted.

Changes to `src/executor/executor.ts` or the safety-related parts of
`src/cli/cli.ts` require explicit review.

## Adding a new language detector

1. **Create the detector** at `src/detectors/<lang>.ts`. Implement the
   `Detector` interface:

   ```ts
   export class FooDetector implements Detector {
     id = 'foo';
     name = 'Foo';
     async detect(ctx: DetectorContext): Promise<DetectorResult> {
       // Read files from ctx.allFiles, parse manifests, push to ctx.diagnostics.
       // Return an empty DetectorResult if nothing is found — never throw.
     }
   }
   ```

2. **Register it** in `src/core/orchestrator.ts`:

   ```ts
   const detectors: Detector[] = [
     new NodeDetector(),
     new PythonDetector(),
     new GoDetector(),
     new DockerDetector(),
     new GenericDetector(),
     new FooDetector(),  // ← add here
   ];
   ```

3. **Add plan logic** in `src/planner/planner.ts`. Add a `fooPlans()`
   function and dispatch from `buildPlans()`:

   ```ts
   } else if (primaryLang?.id === 'foo' && primaryPm) {
     ({ installPlan, runPlan, buildPlan, testPlan, deployPlan } =
       await fooPlans(input, primaryPm, requiredEnv));
   }
   ```

4. **Add fixtures** under `fixtures/<lang>-app/`. Include at minimum:
   - A manifest file
   - An entrypoint (if applicable)
   - A `.env.example` (if applicable)
   - A `README.md`

5. **Add tests** in `tests/<lang>-detector.test.ts`. Cover:
   - Happy path (manifest detected, confidence is high)
   - Missing manifest (empty result, no throw)
   - Malformed manifest (diagnostic emitted)
   - Entrypoint detection

6. **Update `docs/architecture.md`** to mention the new detector.

## Adding a framework

Add a row to `FRAMEWORK_SIGNATURES` in the relevant detector:

```ts
{ id: 'foo', name: 'Foo', deps: ['foo-framework'], files: ['foo.config.js'] },
```

No other changes are required for detection. Add planner integration only if
the framework changes install/run/build/test commands or deploy targets.

## Adding a test

Tests use Vitest. Place them in `tests/`. Follow the existing patterns:

- **Detector tests** — build a `DetectorContext` from a fixture, call
  `detect()`, assert on the result.
- **End-to-end tests** — call `scanProject()` against a fixture, assert on
  the full `ProjectScanResult`.
- **CLI tests** — call `buildProgram().parseAsync()`, capture stdout/stderr,
  assert on the output.

Always include both happy-path and failure-case tests.

## Running real-world validation

Before opening a PR that touches detection logic, run the real-world
validation harness:

```sh
# clone some real repos
mkdir -p /tmp/pst-realworld
cd /tmp/pst-realworld
git clone --depth 1 https://github.com/expressjs/express.git
git clone --depth 1 https://github.com/tiangolo/fastapi.git
# ... etc

# run PST against all of them
cd /path/to/pst
node scripts/realworld.js /tmp/pst-realworld
```

The harness prints a compact table of per-repo detections. If your change
regresses any repo, fix it before opening the PR.

## Reporting bugs

Open a GitHub issue with:

1. The PST version (`pst --version`)
2. The OS and Node version
3. The repo you scanned (or a minimal reproducer)
4. The exact command you ran
5. The output (text or JSON)
6. What you expected vs. what happened

If the bug is in detection, run `pst explain <repo> --offline` and include
the output — it shows the confidence and rationale for every inference.

## Code style

- TypeScript strict mode (enforced by `tsconfig.json`)
- ESM modules (`.js` extensions in imports, required by Node ESM)
- No `any` types without a comment explaining why
- No `// TODO` in core paths — finish the work or open an issue
- Functions stay under ~80 lines where possible; extract helpers

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.
