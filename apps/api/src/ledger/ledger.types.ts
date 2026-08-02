import type { WalletOwnerType } from '@agentwork/contracts';
export interface OperationContext {
  idempotencyKey: string;
}
export interface AdminContext extends OperationContext {
  reason: string;
  operatorId: string;
}
export interface WalletSubject {
  ownerType: WalletOwnerType;
  ownerId: string;
}
export interface TransactionResult {
  transactionId: string;
  duplicate: boolean;
}
