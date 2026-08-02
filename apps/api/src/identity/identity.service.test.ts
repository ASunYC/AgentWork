/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import {
  SignupGrantPort,
  type SignupGrantIntent,
} from '../common/signup-grant.port';
import { IdentityService } from './identity.service';

class IdempotentGrantFake extends SignupGrantPort {
  readonly intents = new Map<string, SignupGrantIntent>();
  async request(intent: SignupGrantIntent) {
    if (!this.intents.has(intent.fingerprint))
      this.intents.set(intent.fingerprint, intent);
  }
}

function database() {
  const users = new Map<string, any>();
  return {
    users,
    user: {
      create: vi.fn(async ({ data }: any) => {
        if (users.has(data.email))
          throw Object.assign(new Error(), { code: 'P2002' });
        const user = {
          id: `u-${users.size + 1}`,
          ...data,
          createdAt: new Date(),
        };
        users.set(data.email, user);
        return user;
      }),
      findUnique: vi.fn(async ({ where }: any) => users.get(where.email)),
      findUniqueOrThrow: vi.fn(async ({ where }: any) =>
        [...users.values()].find((user) => user.id === where.id),
      ),
    },
  };
}

describe('IdentityService', () => {
  it('hashes with Argon2id, normalizes email and requests one grant intent', async () => {
    const db = database();
    const grants = new IdempotentGrantFake();
    const service = new IdentityService(db as never, grants);
    const result = await service.register(
      ' Person@Example.COM ',
      'correct horse battery',
    );
    expect(result.user.email).toBe('person@example.com');
    expect(db.users.get('person@example.com').passwordHash).toMatch(
      /^\$argon2id\$/,
    );
    expect(grants.intents.size).toBe(1);
    await grants.request([...grants.intents.values()][0]!);
    expect(grants.intents.size).toBe(1);
  });

  it('rejects duplicate registration', async () => {
    const db = database();
    const service = new IdentityService(db as never, new IdempotentGrantFake());
    await service.register('same@example.com', 'correct horse battery');
    await expect(
      service.register('same@example.com', 'correct horse battery'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an incorrect password', async () => {
    const db = database();
    const service = new IdentityService(db as never, new IdempotentGrantFake());
    await service.register('person@example.com', 'correct horse battery');
    await expect(
      service.login('person@example.com', 'wrong password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
