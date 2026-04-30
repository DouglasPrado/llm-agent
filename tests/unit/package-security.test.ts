import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as Record<string, unknown>;

describe('package.json security overrides (issue #26)', () => {
  it('should have a top-level "overrides" field for npm compatibility', () => {
    expect(pkg).toHaveProperty('overrides');
    expect(typeof pkg['overrides']).toBe('object');
  });

  it('should pin hono to >=4.12.14 to fix GHSA-26pp, GHSA-r5rp, GHSA-xf4j, GHSA-wmmm, GHSA-458j, GHSA-xpcf', () => {
    const overrides = pkg['overrides'] as Record<string, string>;
    expect(overrides).toHaveProperty('hono');
    // Must satisfy >=4.12.14 (the minimum safe version for all hono CVEs)
    expect(overrides['hono']).toBe('>=4.12.14');
  });

  it('should pin @hono/node-server to >=1.19.13 to fix GHSA-92pp', () => {
    const overrides = pkg['overrides'] as Record<string, string>;
    expect(overrides).toHaveProperty('@hono/node-server');
    expect(overrides['@hono/node-server']).toBe('>=1.19.13');
  });

  it('should pin postcss to >=8.5.10 to fix GHSA-qx2v', () => {
    const overrides = pkg['overrides'] as Record<string, string>;
    expect(overrides).toHaveProperty('postcss');
    expect(overrides['postcss']).toBe('>=8.5.10');
  });
});
