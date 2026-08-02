/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { generateKeyPairSync, sign as signMessage } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import {
  SignupGrantPort,
  type SignupGrantIntent,
} from '../common/signup-grant.port';
import { AgentsService } from './agents.service';
import { UrlSafetyService } from './url-safety.service';

class Grants extends SignupGrantPort {
  readonly intents = new Map<string, SignupGrantIntent>();
  async request(intent: SignupGrantIntent) {
    this.intents.set(intent.fingerprint, intent);
  }
}

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const agent: any = {
    id: 'agent-1',
    ownerUserId: 'user-1',
    slug: 'test-agent',
    status: 'PENDING_VERIFICATION',
    endpoints: [
      {
        id: 'endpoint-1',
        publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
        webhookUrl: 'https://agent.example/hook',
      },
    ],
  };
  const apiKeys: any[] = [];
  const db: any = {
    agent: {
      create: vi.fn(async () => agent),
      findUnique: vi.fn(async () => agent),
      update: vi.fn(async ({ data }: any) => Object.assign(agent, data)),
    },
    agentEndpoint: { update: vi.fn(async () => undefined) },
    apiKey: {
      create: vi.fn(async ({ data }: any) => {
        apiKeys.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };
  const safety = {
    assertPublicHttps: vi.fn(async (raw: string) => new URL(raw)),
  } as unknown as UrlSafetyService;
  const grants = new Grants();
  const webhook = { send: vi.fn(async () => undefined) };
  return {
    service: new AgentsService(db, safety, grants, webhook),
    db,
    agent,
    privateKey,
    apiKeys,
    grants,
  };
}

describe('AgentsService verification', () => {
  it('verifies Ed25519 and stores only the API key hash', async () => {
    const { service, privateKey, apiKeys, grants } = fixture();
    const subscription = await service.subscribe('user-1', {
      name: 'Test',
      slug: 'test-agent',
      description: 'test',
      webhookUrl: 'https://agent.example/hook',
      publicKey: 'unused',
      capabilities: [{ capability: 'code', proficiency: 5 }],
      languages: ['en'],
    });
    const signature = signMessage(
      null,
      Buffer.from(subscription.challenge),
      privateKey,
    ).toString('base64');
    const result = await service.activate(subscription.challenge, signature);
    expect(result.apiKey).toMatch(/^awk_/);
    expect(apiKeys[0].keyHash).not.toContain(result.apiKey);
    expect(apiKeys[0].keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(grants.intents.size).toBe(1);
  });

  it('rejects an incorrect signature', async () => {
    const { service } = fixture();
    const subscription = await service.subscribe('user-1', {
      name: 'Test',
      slug: 'test-agent',
      description: 'test',
      webhookUrl: 'https://agent.example/hook',
      publicKey: 'unused',
      capabilities: [{ capability: 'code', proficiency: 5 }],
      languages: ['en'],
    });
    await expect(
      service.activate(
        subscription.challenge,
        Buffer.alloc(64).toString('base64'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects expired challenges and repeated verification', async () => {
    const { service, agent, privateKey } = fixture();
    const expired = sign(
      { agentId: agent.id, purpose: 'agent-webhook' },
      'development-only-change-me',
      { expiresIn: -1 },
    );
    await expect(service.activate(expired, '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const challenge = sign(
      { agentId: agent.id, purpose: 'agent-webhook' },
      'development-only-change-me',
      { expiresIn: '1m' },
    );
    agent.status = 'ACTIVE';
    const signature = signMessage(
      null,
      Buffer.from(challenge),
      privateKey,
    ).toString('base64');
    await expect(service.activate(challenge, signature)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
