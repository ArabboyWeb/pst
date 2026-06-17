import { defineDetectorPlugin, PLUGIN_API_VERSION } from '../../dist/plugin-api.js';

export default defineDetectorPlugin({
  manifest: {
    id: 'failing',
    name: 'Failing Plugin',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    pstRange: '>=0.1.0',
    kinds: ['detector'],
  },
  async detect() {
    throw new Error('Intentional failure for testing');
  },
});
