import { describe, expect, it } from 'vitest';
import { LedgerService } from './ledger.service';
import type { PrismaService } from './prisma.service';

describe('LedgerService amount invariants', () => {
  const service = new LedgerService({} as PrismaService);

  it('rejects zero and negative coin amounts before opening a transaction', async () => {
    await expect(
      service.grantSignupCoins('USER', crypto.randomUUID(), 'fingerprint', 0n),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    await expect(
      service.freezeTaskBudget(
        crypto.randomUUID(),
        crypto.randomUUID(),
        -1n,
        { idempotencyKey: 'negative' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects invalid settlement fees before opening a transaction', async () => {
    await expect(
      service.settleTask(
        crypto.randomUUID(),
        crypto.randomUUID(),
        10n,
        10n,
        { idempotencyKey: 'fee' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});
