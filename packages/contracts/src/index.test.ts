import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './index.js';

describe('healthResponseSchema', () => {
  it('accepts the shared health contract', () => {
    expect(
      healthResponseSchema.parse({ status: 'ok', service: 'api' }),
    ).toEqual({
      status: 'ok',
      service: 'api',
    });
  });
});
