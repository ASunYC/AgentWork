import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type SignupGrantSubject = 'USER' | 'AGENT';
export interface SignupGrantIntent {
  subjectType: SignupGrantSubject;
  subjectId: string;
  fingerprint: string;
  amount: bigint;
}

export abstract class SignupGrantPort {
  abstract request(intent: SignupGrantIntent): Promise<void>;
}

@Injectable()
export class UnconfiguredSignupGrantAdapter extends SignupGrantPort {
  request(): Promise<void> {
    throw new ServiceUnavailableException(
      'SignupGrantPort is not provided by LedgerModule',
    );
  }
}
