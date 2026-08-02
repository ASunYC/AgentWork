export const LEDGER_PORT = Symbol('LEDGER_PORT');
export type LedgerRequest = {
  taskId: string;
  publisherId: string;
  agentId?: string;
  amount: bigint;
  idempotencyKey: string;
  transaction?: unknown;
};
export interface LedgerPort {
  freeze(request: LedgerRequest): Promise<void>;
  settle(request: LedgerRequest): Promise<void>;
  refund(request: LedgerRequest): Promise<void>;
}
export class UnconfiguredLedgerPort implements LedgerPort {
  private fail(): never {
    throw new Error('LedgerPort provider is not configured');
  }
  freeze(): Promise<void> {
    return Promise.reject(this.fail());
  }
  settle(): Promise<void> {
    return Promise.reject(this.fail());
  }
  refund(): Promise<void> {
    return Promise.reject(this.fail());
  }
}
export class FakeLedgerPort implements LedgerPort {
  freezes: LedgerRequest[] = [];
  settlements: LedgerRequest[] = [];
  refunds: LedgerRequest[] = [];
  failFreeze = false;
  async freeze(r: LedgerRequest) {
    if (this.failFreeze) throw new Error('freeze failed');
    if (!this.freezes.some((x) => x.idempotencyKey === r.idempotencyKey))
      this.freezes.push(r);
  }
  async settle(r: LedgerRequest) {
    if (!this.settlements.some((x) => x.idempotencyKey === r.idempotencyKey))
      this.settlements.push(r);
  }
  async refund(r: LedgerRequest) {
    if (!this.refunds.some((x) => x.idempotencyKey === r.idempotencyKey))
      this.refunds.push(r);
  }
}
