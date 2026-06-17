import { buildProgram } from './cli/cli.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  // Top-level error handler. Avoid printing a stack trace in normal user
  // flow unless --debug was passed. Always exit non-zero on uncaught errors.
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(msg);
  if (process.argv.includes('--debug') && err instanceof Error && err.stack) {
    logger.error(err.stack);
  } else {
    logger.error('Re-run with --debug for a full stack trace.');
  }
  process.exit(1);
});
