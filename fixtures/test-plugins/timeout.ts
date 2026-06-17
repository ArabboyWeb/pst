/**
 * Timeout plugin — detect() hangs forever.
 */
import { defineDetectorPlugin, PLUGIN_API_VERSION } from '../../dist/plugin-api.js';

export default defineDetectorPlugin({
  manifest: {
    id: 'timeout',
    name: 'Timeout Plugin',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    pstRange: '>=0.1.0',
    kinds: ['detector'],
  },
  async detect() {
    // Never resolves — the loader's timeout should kill this.
    return new Promise(() => {});
  },
});
