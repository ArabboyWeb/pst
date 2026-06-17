import { defineDetectorPlugin, conf, PLUGIN_API_VERSION } from '../../src/plugin-api/index.js';

export default defineDetectorPlugin({
  manifest: {
    id: 'mock',
    name: 'Mock Plugin',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    pstRange: '>=0.1.0',
    kinds: ['detector'],
    owns: ['mock-lang'],
  },
  async detect() {
    return {
      languages: [{
        id: 'mock-lang' as never,
        name: 'Mock Language',
        evidence: ['mock-evidence'],
        confidence: conf(0.5, 'Mock detection for testing'),
      }],
      frameworks: [],
      packageManagers: [],
      manifests: [],
      files: [],
      env: [],
      entrypoints: [],
    };
  },
});
