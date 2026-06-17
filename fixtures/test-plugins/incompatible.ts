/**
 * Incompatible plugin — declares apiVersion 999 (not supported by PST).
 */
import { defineDetectorPlugin } from '../../src/plugin-api/index.js';

export default defineDetectorPlugin({
  manifest: {
    id: 'incompatible',
    name: 'Incompatible Plugin',
    version: '1.0.0',
    apiVersion: 999 as never, // Incompatible!
    pstRange: '^99.0.0',      // Also incompatible
    kinds: ['detector'],
  },
  async detect() {
    return {
      languages: [],
      frameworks: [],
      packageManagers: [],
      manifests: [],
      files: [],
      env: [],
      entrypoints: [],
    };
  },
});
