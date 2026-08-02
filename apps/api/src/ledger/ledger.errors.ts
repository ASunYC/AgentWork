import { HttpException, HttpStatus } from '@nestjs/common';

export type LedgerErrorCode =
  | 'WALLET_NOT_FOUND'
  | 'INSUFFICIENT_COINS'
  | 'INVALID_AMOUNT'
  | 'DUPLICATE_OPERATION'
  | 'TRANSACTION_NOT_REVERSIBLE'
  | 'LEDGER_IMBALANCE';
export class LedgerError extends HttpException {
  constructor(
    public readonly code: LedgerErrorCode,
    message: string,
    status = HttpStatus.BAD_REQUEST,
    details: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }
}
