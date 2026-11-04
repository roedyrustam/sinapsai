import { describe, expect, it, vi } from 'vitest';
import { buildClientFromEnv, runCli } from './index.js';

describe('SinapsAI CLI runner', () => {
  it('should display help message', async () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    await runCli(['--help']);
    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('SinapsAI CLI');
    expect(output).toContain('serve');
    expect(output).toContain('mcp');
    writeSpy.mockRestore();
  });

  it('should display version', async () => {
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    await runCli(['--version']);
    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toMatch(/sinapsai v2\.\d+\.\d+/);
    writeSpy.mockRestore();
  });

  it('should instantiate client from environment variables', () => {
    const client = buildClientFromEnv();
    expect(client).toBeDefined();
    expect(client.strategy).toBe('adaptive');
  });
});
