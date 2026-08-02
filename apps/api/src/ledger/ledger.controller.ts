import { Controller, Get, Headers, Query } from '@nestjs/common';
import { walletOwnerTypeSchema } from '@agentwork/contracts';
import { LedgerError } from './ledger.errors';
import { LedgerService } from './ledger.service';

@Controller('v1/wallet')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  getWallet(
    @Headers('x-owner-type') type: string,
    @Headers('x-owner-id') ownerId: string,
  ) {
    return this.ledger.getWallet(this.subject(type, ownerId));
  }

  @Get('transactions')
  getTransactions(
    @Headers('x-owner-type') type: string,
    @Headers('x-owner-id') ownerId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new LedgerError(
        'INVALID_AMOUNT',
        'limit must be an integer from 1 to 100',
      );
    return this.ledger.listTransactions(
      this.subject(type, ownerId),
      cursor,
      limit,
    );
  }

  private subject(type: string, ownerId: string) {
    const parsed = walletOwnerTypeSchema.safeParse(type);
    if (
      !parsed.success ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        ownerId,
      )
    )
      throw new LedgerError(
        'WALLET_NOT_FOUND',
        'Authenticated wallet subject is missing',
        404,
      );
    return { ownerType: parsed.data, ownerId };
  }
}
