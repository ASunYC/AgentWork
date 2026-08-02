import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveWebhookSecret, verifyWebhookSignature } from './index.js';

describe('Webhook verification', () => {
  it('accepts a current signature and rejects modified content', () => {
    const secret = deriveWebhookSecret('master', 'endpoint', 1);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = '{"event":"task.assigned"}';
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')}`;
    expect(verifyWebhookSignature(secret, timestamp, body, signature)).toBe(
      true,
    );
    expect(
      verifyWebhookSignature(secret, timestamp, `${body} `, signature),
    ).toBe(false);
  });

  it('rejects stale timestamps before comparing signatures', () => {
    expect(verifyWebhookSignature('secret', '0', '{}', 'sha256=00')).toBe(
      false,
    );
  });
});
