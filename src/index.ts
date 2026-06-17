export { buildProgram } from './cli/cli.js';
export { scanProject } from './core/index.js';
export type { ScanOptions } from './core/index.js';
export { execute, executeSequence } from './executor/index.js';
export { renderReport, renderText, renderMarkdown } from './reporter/index.js';
export {
  NodeDetector,
  PythonDetector,
  GoDetector,
  DockerDetector,
  GenericDetector,
} from './detectors/index.js';
export type { Detector, DetectorContext, DetectorResult } from './detectors/index.js';
export { buildPlans } from './planner/index.js';
export type { PlannerInput, PlannerOutput } from './planner/index.js';
// Plugin system
export { PluginManager } from './plugins/manager.js';
export type { PluginManagerOptions } from './plugins/manager.js';
export { loadPlugins, getBuiltinPlugins, PLUGIN_API_VERSION } from './plugins/index.js';
export type { LoadedPlugin, LoadOptions } from './plugins/loader.js';
export * from './plugin-api/index.js';
export * from './types/index.js';
export { logger } from './utils/logger.js';
export { conf, combineConfidences, levelFromScore } from './utils/confidence.js';
export { which, versionOf, shellQuote, joinCommand } from './utils/runtime.js';
export const VERSION = '0.1.0';
