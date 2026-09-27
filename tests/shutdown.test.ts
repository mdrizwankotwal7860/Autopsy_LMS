import { spawn } from 'child_process';
import path from 'path';
import { describe, it, expect } from '@jest/globals';

const runServerAndTriggerInternally = (
  envOpts: Record<string, string>,
  triggerScript: string
): Promise<{ stdout: string; stderr: string; code: number | null }> => {
  return new Promise((resolve) => {
    const proc = spawn('node', ['-e', `
      require('./dist/server.js');
      ${triggerScript}
    `], {
      env: { ...process.env, PORT: '0', ...envOpts },
      cwd: path.resolve(__dirname, '..'),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
};

describe('Graceful Shutdown & Resource Lifecycle', () => {
  it('SIGTERM triggers graceful shutdown and exits with 0', async () => {
    const { stdout, code } = await runServerAndTriggerInternally({}, `
      setTimeout(() => process.emit('SIGTERM'), 1000);
    `);
    expect(stdout).toMatch(/\[SIGTERM\] Shutdown initiated/);
    expect(stdout).toMatch(/Closing HTTP server/);
    expect(stdout).toMatch(/HTTP server drained/);
    expect(stdout).toMatch(/Disconnecting Prisma/);
    expect(stdout).toMatch(/Prisma disconnected/);
    expect(stdout).toMatch(/Graceful shutdown completed\./);
    expect(code).toBe(0);
  }, 20000);

  it('SIGINT triggers graceful shutdown and exits with 0', async () => {
    const { stdout, code } = await runServerAndTriggerInternally({}, `
      setTimeout(() => process.emit('SIGINT'), 1000);
    `);
    expect(stdout).toMatch(/\[SIGINT\] Shutdown initiated/);
    expect(stdout).toMatch(/Graceful shutdown completed\./);
    expect(code).toBe(0);
  }, 20000);

  it('shutdown is idempotent (second signal is ignored)', async () => {
    const { stdout, code } = await runServerAndTriggerInternally({}, `
      setTimeout(() => {
        process.emit('SIGTERM');
        setTimeout(() => process.emit('SIGINT'), 100);
      }, 1000);
    `);
    const matches = stdout.match(/Shutdown initiated/g);
    expect(matches?.length).toBe(1);
    expect(code).toBe(0);
  }, 20000);

  it('shutdown works even when Redis is disabled/unavailable', async () => {
    const { stdout, code } = await runServerAndTriggerInternally({ REDIS_URL: '' }, `
      setTimeout(() => process.emit('SIGTERM'), 1000);
    `);
    expect(stdout).toMatch(/Prisma disconnected/);
    expect(stdout).not.toMatch(/Closing Redis/);
    expect(stdout).toMatch(/Graceful shutdown completed\./);
    expect(code).toBe(0);
  }, 20000);

  it('uncaughtException triggers shutdown with exit code 1', async () => {
    const { stdout, stderr, code } = await runServerAndTriggerInternally({}, `
      setTimeout(() => { throw new Error('Test Uncaught Exception'); }, 1000);
    `);
    expect(stderr).toMatch(/Test Uncaught Exception/);
    expect(stdout).toMatch(/\[uncaughtException\] Shutdown initiated/);
    expect(code).toBe(1);
  }, 20000);

  it('unhandledRejection triggers shutdown with exit code 1', async () => {
    const { stdout, stderr, code } = await runServerAndTriggerInternally({}, `
      setTimeout(() => { Promise.reject(new Error('Test Unhandled Rejection')); }, 1000);
    `);
    expect(stderr).toMatch(/Test Unhandled Rejection/);
    expect(stdout).toMatch(/\[unhandledRejection\] Shutdown initiated/);
    expect(code).toBe(1);
  }, 20000);
  
  it('timeout forces exit code 1 if shutdown hangs', async () => {
    const proc = spawn('node', ['-e', `
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = function(fn, ms) {
        if (ms === 15000) return originalSetTimeout(fn, 100);
        return originalSetTimeout(fn, ms);
      };
      
      const http = require('http');
      http.Server.prototype.close = function(cb) {
        // do not call cb to simulate hang
      };
      
      require('./dist/server.js');
      originalSetTimeout(() => process.emit('SIGTERM'), 1000);
    `], {
      env: { ...process.env, PORT: '0' },
      cwd: path.resolve(__dirname, '..'),
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => stdout += d.toString());
    proc.stderr.on('data', (d) => stderr += d.toString());

    const code = await new Promise((resolve) => proc.on('close', resolve));
    expect(stdout).toMatch(/\[SIGTERM\] Shutdown initiated/);
    expect(stderr).toMatch(/\[Timeout\] Graceful shutdown took too long/);
    expect(code).toBe(1);
  }, 20000);
  
  it('Prisma disconnect failure -> Redis cleanup is still attempted -> process exits with code 1', async () => {
    const proc = spawn('node', ['-e', `
      const prisma = require('./dist/utils/prisma').default;
      prisma.$disconnect = async () => { throw new Error('Prisma disconnect failed'); };
      
      require('./dist/server.js');
      setTimeout(() => process.emit('SIGTERM'), 1000);
    `], {
      env: { ...process.env, PORT: '0', REDIS_URL: 'redis://localhost:6379' },
      cwd: path.resolve(__dirname, '..'),
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => stdout += d.toString());
    proc.stderr.on('data', (d) => stderr += d.toString());

    const code = await new Promise((resolve) => proc.on('close', resolve));
    expect(stderr).toMatch(/Error disconnecting Prisma:/);
    expect(stderr).toMatch(/Prisma disconnect failed/);
    expect(stdout).toMatch(/Closing Redis.../); // Proves Redis cleanup was attempted
    expect(stdout).toMatch(/Graceful shutdown completed\./);
    expect(code).toBe(1);
  }, 20000);

  it('Redis disconnect failure -> shutdown still completes -> process exits with code 1', async () => {
    const proc = spawn('node', ['-e', `
      const redisClient = require('./dist/utils/redis').default;
      if (redisClient) {
        redisClient.quit = async () => { throw new Error('Redis disconnect failed'); };
      }
      
      require('./dist/server.js');
      setTimeout(() => process.emit('SIGTERM'), 1000);
    `], {
      env: { ...process.env, PORT: '0', REDIS_URL: 'redis://localhost:6379' },
      cwd: path.resolve(__dirname, '..'),
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => stdout += d.toString());
    proc.stderr.on('data', (d) => stderr += d.toString());

    const code = await new Promise((resolve) => proc.on('close', resolve));
    expect(stdout).toMatch(/Prisma disconnected\./); // Proves Prisma cleanup succeeded
    expect(stderr).toMatch(/Error closing Redis:/);
    expect(stderr).toMatch(/Redis disconnect failed/);
    expect(stdout).toMatch(/Graceful shutdown completed\./);
    expect(code).toBe(1);
  }, 20000);
});
