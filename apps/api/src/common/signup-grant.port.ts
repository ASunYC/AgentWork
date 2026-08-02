export type SignupGrantSubject = 'USER' | 'AGENT';
export interface SignupGrantIntent {
  subjectType: SignupGrantSubject;
  subjectId: string;
  fingerprint: string;
  amount: bigint;
  transaction?: unknown;
}

export abstract class SignupGrantPort {
  abstract request(intent: SignupGrantIntent): Promise<void>;
}
