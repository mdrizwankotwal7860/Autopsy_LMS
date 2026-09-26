import { spawnSync } from 'child_process';
import path from 'path';
import { describe, it, expect } from '@jest/globals';

describe('Production Startup Safety', () => {
  it('missing JWT_SECRET prevents production startup', () => {
    // Run the server script (or jwt util) as a separate process without JWT_SECRET
    // We can just try to run `node -e "require('./dist/utils/jwt.js')"`
    // Or we can just run ts-node if we want to run the ts file.
    
    // We will just run a small node script that imports jwt.ts and expect it to throw.
    const result = spawnSync('node', ['dist/utils/jwt.js'], {
      env: { ...process.env, JWT_SECRET: '' },
      cwd: path.resolve(__dirname, '..'),
    });

    const output = (result.stderr || result.stdout || '').toString();
    if (result.error) {
      console.log('Spawn error:', result.error);
    }
    expect(output).toMatch(/FATAL ERROR: JWT_SECRET is not defined in environment variables/i);
  });
});
