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
    expect(output).toContain('dashboard');
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
    expect(output).toMatch(/sinapsai v\d+\.\d+\.\d+/);
    writeSpy.mockRestore();
  });

  it('should instantiate client from environment variables', () => {
    const client = buildClientFromEnv();
    expect(client).toBeDefined();
    expect(client.strategy).toBe('adaptive');
  });

  it('should auto-register QwenProvider when QWEN_API_KEY or DASHSCOPE_API_KEY is set', async () => {
    const prevQwen = process.env.QWEN_API_KEY;
    const prevDash = process.env.DASHSCOPE_API_KEY;
    try {
      process.env.QWEN_API_KEY = 'sk-qwen-env-test';
      delete process.env.DASHSCOPE_API_KEY;
      const client = buildClientFromEnv();
      const health = await client.checkHealth();
      const hasQwen = health.providers.some((p) => p.id.startsWith('qwen-'));
      expect(hasQwen).toBe(true);
    } finally {
      if (prevQwen === undefined) delete process.env.QWEN_API_KEY;
      else process.env.QWEN_API_KEY = prevQwen;
      if (prevDash === undefined) delete process.env.DASHSCOPE_API_KEY;
      else process.env.DASHSCOPE_API_KEY = prevDash;
    }
  });
});
