import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, PrismaClient } from '@agentwork/database';
import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from 'node:crypto';
import { sign, verify } from 'jsonwebtoken';
import { PRISMA } from '../common/database';
import { SignupGrantPort } from '../common/signup-grant.port';
import type {
  HeartbeatDto,
  PatchAgentDto,
  SubscribeAgentDto,
} from './agents.dto';
import { UrlSafetyService } from './url-safety.service';
import { WebhookChallengePort } from './webhook-challenge';
import { DomainEventPublisherPort } from '../webhooks/domain-event.publisher';

const publicAgent = {
  id: true,
  slug: true,
  name: true,
  description: true,
  status: true,
  verificationLevel: true,
  manifestVersion: true,
  createdAt: true,
  updatedAt: true,
  capabilities: {
    select: { capability: true, proficiency: true, evidence: true },
  },
  heartbeats: {
    orderBy: { lastSeenAt: 'desc' as const },
    take: 1,
    select: { status: true, capacity: true, lastSeenAt: true },
  },
};

@Injectable()
export class AgentsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly safety: UrlSafetyService,
    private readonly grants: SignupGrantPort,
    private readonly webhook: WebhookChallengePort,
    private readonly domainEvents: DomainEventPublisherPort,
  ) {}

  async subscribe(ownerUserId: string, dto: SubscribeAgentDto) {
    await this.safety.assertPublicHttps(dto.webhookUrl);
    let agent;
    try {
      agent = await this.db.agent.create({
        data: {
          ownerUserId,
          slug: dto.slug,
          name: dto.name,
          description: dto.description,
          manifestVersion: '1',
          endpoints: {
            create: { webhookUrl: dto.webhookUrl, publicKey: dto.publicKey },
          },
          capabilities: {
            create: dto.capabilities.map((item) => ({
              ...item,
              evidence: { languages: dto.languages },
            })),
          },
        },
        include: { endpoints: true },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new ConflictException('Agent slug is already registered');
      throw error;
    }
    const challenge = sign(
      {
        agentId: agent.id,
        nonce: randomBytes(24).toString('base64url'),
        purpose: 'agent-webhook',
      },
      this.challengeSecret(),
      { expiresIn: '10m', subject: agent.id },
    );
    await this.webhook.send(dto.webhookUrl, challenge);
    return { agentId: agent.id, challenge, expiresIn: 600 };
  }

  async activate(challenge: string, signature: string) {
    let payload: { agentId?: string; purpose?: string };
    try {
      payload = verify(challenge, this.challengeSecret()) as typeof payload;
    } catch {
      throw new BadRequestException('Challenge is invalid or expired');
    }
    if (!payload.agentId || payload.purpose !== 'agent-webhook')
      throw new BadRequestException('Invalid challenge');
    const agent = await this.db.agent.findUnique({
      where: { id: payload.agentId },
      include: { endpoints: true },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status === 'ACTIVE')
      throw new ConflictException('Agent is already verified');
    const endpoint = agent.endpoints[0];
    if (!endpoint) throw new BadRequestException('Agent endpoint is missing');
    let valid = false;
    try {
      const key = endpoint.publicKey.includes('BEGIN')
        ? createPublicKey(endpoint.publicKey)
        : createPublicKey({
            key: Buffer.from(endpoint.publicKey, 'base64'),
            format: 'der',
            type: 'spki',
          });
      valid = verifySignature(
        null,
        Buffer.from(challenge),
        key,
        Buffer.from(signature, 'base64'),
      );
    } catch {
      valid = false;
    }
    if (!valid) throw new BadRequestException('Challenge signature is invalid');
    await this.db.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id: agent.id },
        data: { status: 'ACTIVE', verificationLevel: 'ENDPOINT' },
      });
      await tx.agentEndpoint.update({
        where: { id: endpoint.id },
        data: { verifiedAt: new Date() },
      });
      await this.grants.request({
        subjectType: 'AGENT',
        subjectId: agent.id,
        fingerprint: createHash('sha256')
          .update(`agent:${endpoint.publicKey}`)
          .digest('hex'),
        amount: 1000n,
        transaction: tx,
      });
      await this.domainEvents.publish(
        'agent.verified',
        agent.id,
        { agent_id: agent.id, verification_level: 'ENDPOINT' },
        tx,
        `agent:${agent.id}:verified:endpoint`,
      );
    });
    return {
      agentId: agent.id,
      apiKey: await this.issueKey(agent.id, [
        'agent:read',
        'agent:write',
        'agent:heartbeat',
        'agent:keys',
      ]),
    };
  }

  async getMine(id: string) {
    return this.db.agent.findUniqueOrThrow({
      where: { id },
      select: publicAgent,
    });
  }
  async patch(id: string, dto: PatchAgentDto) {
    const { capabilities, languages, ...data } = dto;
    return this.db.$transaction(async (tx: Prisma.TransactionClient) => {
      if (capabilities) {
        await tx.agentCapability.deleteMany({ where: { agentId: id } });
        await tx.agentCapability.createMany({
          data: capabilities.map((x) => ({
            agentId: id,
            ...x,
            evidence: { languages: languages ?? [] },
          })),
        });
      }
      return tx.agent.update({ where: { id }, data, select: publicAgent });
    });
  }
  async heartbeat(id: string, dto: HeartbeatDto) {
    return this.db.agentHeartbeat.create({
      data: {
        agentId: id,
        status: dto.status,
        capacity: dto.capacity,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
        lastSeenAt: new Date(),
      },
    });
  }
  async rotateKey(id: string, scopes?: string[]) {
    await this.db.apiKey.updateMany({
      where: { agentId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return {
      apiKey: await this.issueKey(
        id,
        scopes ?? [
          'agent:read',
          'agent:write',
          'agent:heartbeat',
          'agent:keys',
        ],
      ),
    };
  }
  list() {
    return this.db.agent.findMany({
      where: { status: { in: ['ACTIVE', 'OFFLINE', 'PAUSED'] } },
      select: publicAgent,
      orderBy: { createdAt: 'desc' },
    });
  }
  async bySlug(slug: string) {
    const agent = await this.db.agent.findFirst({
      where: { slug, status: { in: ['ACTIVE', 'OFFLINE', 'PAUSED'] } },
      select: publicAgent,
    });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }
  private async issueKey(agentId: string, scopes: string[]) {
    const plain = `awk_${randomBytes(32).toString('base64url')}`;
    await this.db.apiKey.create({
      data: {
        agentId,
        scopes: [...new Set(scopes)],
        keyHash: createHash('sha256').update(plain).digest('hex'),
      },
    });
    return plain;
  }
  private challengeSecret() {
    const secret = process.env.CHALLENGE_SECRET;
    if (!secret) throw new Error('CHALLENGE_SECRET is required');
    return secret;
  }
}
