import { describe, expect, it } from 'vitest';
import { configSchema } from '../src/config.js';

const required = {
  DATABASE_URL: 'postgresql://airem:secret@postgres:5432/airem',
  COOKIE_SECRET: 'a-cookie-secret-with-at-least-32-characters',
};

describe('gateway configuration', () => {
  it.each(['0', '-1', '1.5', 'not-a-number'])('rejects invalid RATE_LIMIT_MAX=%s', value => {
    expect(() => configSchema.parse({ ...required, RATE_LIMIT_MAX: value })).toThrow();
  });

  it('uses the documented default and accepts an override', () => {
    expect(configSchema.parse(required).RATE_LIMIT_MAX).toBe(60);
    expect(configSchema.parse({ ...required, RATE_LIMIT_MAX: '12' }).RATE_LIMIT_MAX).toBe(12);
  });
});
