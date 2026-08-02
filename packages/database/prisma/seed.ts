import {
  LedgerAccountType,
  PrismaClient,
  WalletOwnerType,
} from '@prisma/client';

export const PLATFORM_WALLET_OWNER_ID = '00000000-0000-7000-8000-000000000001';

const SYSTEM_ACCOUNT_TYPES = [
  LedgerAccountType.GRANT_POOL,
  LedgerAccountType.ESCROW,
  LedgerAccountType.FEE,
  LedgerAccountType.ADJUSTMENT,
] as const;

export async function seedSystemAccounts(client: PrismaClient): Promise<void> {
  await client.$transaction(async (transaction) => {
    const wallet = await transaction.wallet.upsert({
      where: {
        ownerType_ownerId: {
          ownerType: WalletOwnerType.PLATFORM,
          ownerId: PLATFORM_WALLET_OWNER_ID,
        },
      },
      update: {},
      create: {
        ownerType: WalletOwnerType.PLATFORM,
        ownerId: PLATFORM_WALLET_OWNER_ID,
      },
    });

    for (const type of SYSTEM_ACCOUNT_TYPES) {
      await transaction.ledgerAccount.upsert({
        where: {
          walletId_type_currencyCode: {
            walletId: wallet.id,
            type,
            currencyCode: 'COIN',
          },
        },
        update: {},
        create: { walletId: wallet.id, type, currencyCode: 'COIN' },
      });
    }
  });
}

async function main(): Promise<void> {
  const client = new PrismaClient();
  try {
    await seedSystemAccounts(client);
  } finally {
    await client.$disconnect();
  }
}

await main();
