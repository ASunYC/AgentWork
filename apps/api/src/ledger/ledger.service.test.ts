import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LedgerService } from './ledger.service';
import type { PrismaClient } from '@agentwork/database';

describe('LedgerService amount invariants', () => {
  const service = new LedgerService(
    {} as PrismaClient,
    {
      publish: async () => ({}) as never,
    } as never,
  );

  it('rejects zero and negative coin amounts before opening a transaction', async () => {
    await expect(
      service.grantSignupCoins('USER', randomUUID(), 'fingerprint', 0n),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    await expect(
      service.freezeTaskBudget(randomUUID(), randomUUID(), -1n, {
        idempotencyKey: 'negative',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects invalid settlement fees before opening a transaction', async () => {
    await expect(
      service.settleTask(randomUUID(), randomUUID(), 10n, 10n, {
        idempotencyKey: 'fee',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});
