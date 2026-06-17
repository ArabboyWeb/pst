import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { scanProject } from '../src/core/index.js';
import { renderReport, renderMarkdown, renderText } from '../src/reporter/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.resolve(__dirname, '../fixtures', name);

describe('Reporter', () => {
  it('renders valid JSON', async () => {
    const scan = await scanProject({ root: fixture('node-app'), offline: true });
    const { content } = renderReport(scan, 'json');
    const parsed = JSON.parse(content);
    expect(parsed.root).toBe(scan.root);
    expect(parsed.languages[0].id).toBe('node');
  });

  it('renders text with key sections', async () => {
    const scan = await scanProject({ root: fixture('node-app'), offline: true });
    const text = renderText(scan);
    expect(text).toContain('PST — Project Intelligence Report');
    expect(text).toContain('Languages');
    expect(text).toContain('Node.js');
    expect(text).toContain('Install plan');
    expect(text).toContain('npm install');
  });

  it('renders markdown with H1 and code blocks', async () => {
    const scan = await scanProject({ root: fixture('node-app'), offline: true });
    const md = renderMarkdown(scan);
    expect(md).toContain('# PST Report');
    expect(md).toContain('## Languages');
    expect(md).toContain('## Install plan');
    expect(md).toContain('npm install');
  });

  it('markdown escapes commands in fenced sh blocks', async () => {
    const scan = await scanProject({ root: fixture('node-app'), offline: true });
    const md = renderMarkdown(scan);
    expect(md).toContain('```sh');
  });

  it('handles empty project gracefully', async () => {
    const scan = await scanProject({ root: fixture('empty-project'), offline: true });
    const text = renderText(scan);
    expect(text).toContain('PST — Project Intelligence Report');
    const md = renderMarkdown(scan);
    expect(md).toContain('_(none detected)_');
    const { content } = renderReport(scan, 'json');
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
