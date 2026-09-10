import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
  HttpException,
} from '@nestjs/common';
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from 'node:crypto';
import { PrismaClient, type Prisma } from '@agentwork/database';
import type { AgentChallengeInput } from '@agentwork/contracts';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function machinePublicKey(value: string) {
  try {
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Unsupported key');
    return key.export({ type: 'spki', format: 'pem' }).toString();
  } catch {
    throw new BadRequestException('An Ed25519 public key is required');
  }
}

export async function persistChallenge(
  db: PrismaClient,
  data: Omit<Prisma.AgentChallengeCreateInput, 'sourceHash'>,
  source: string,
) {
  const sourceHash = hash(source);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`challenge:${sourceHash}`}))`;
    const count = await tx.agentChallenge.count({
      where: { sourceHash, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (count >= 10)
      throw new HttpException(
        'Too many connection attempts; retry in one minute',
        429,
      );
    await tx.agentChallenge.create({ data: { ...data, sourceHash } });
  });
}
export const agentDisplay = {
  id: true,
  slug: true,
  name: true,
  description: true,
  status: true,
} as const;

@Injectable()
export class AgentAccessService {
  constructor(@Inject(PrismaClient) private readonly db: PrismaClient) {}

  async challenge(input: AgentChallengeInput, source: string) {
    const publicKey = machinePublicKey(input.publicKey);
    const id = randomUUID();
    const fingerprint = hash(publicKey);
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const message = JSON.stringify({
      protocol: 'agentwork-connect-v2',
      audience: process.env.AGENTWORK_ORIGIN ?? 'http://localhost:3001',
      challengeId: id,
      fingerprint,
      name: input.name,
      slug: input.slug,
      nonce: randomBytes(32).toString('base64url'),
      expiresAt: expiresAt.toISOString(),
    });
    await persistChallenge(
      this.db,
      {
        id,
        publicKey,
        fingerprint,
        name: input.name,
        slug: input.slug,
        message,
        expiresAt,
      },
      source,
    );
    return { challengeId: id, message, expiresAt };
  }
  async connect(challengeId: string, signature: string, register = true) {
    const challenge = await this.db.agentChallenge.findUnique({
      where: { id: challengeId },
    });
    if (
      !challenge ||
      challenge.purpose !== 'CONNECT' ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date()
    )
      throw new UnauthorizedException('Challenge expired or already consumed');
    if (
      !verify(
        null,
        Buffer.from(challenge.message),
        challenge.publicKey,
        Buffer.from(signature, 'base64'),
      )
    )
      throw new UnauthorizedException('Invalid challenge signature');
    const token = `aws_${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`identity:${challenge.fingerprint}`}))`;
        const consumed = await tx.agentChallenge.updateMany({
          where: {
            id: challengeId,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1)
          throw new UnauthorizedException(
            'Challenge expired or already consumed',
          );
        let installation = await tx.agentInstallation.findUnique({
          where: { fingerprint: challenge.fingerprint },
          include: { agent: { select: agentDisplay } },
        });
        if (!installation) {
          if (!register)
            throw new UnauthorizedException(
              'This device has not been authorized for an Agent',
            );
          if (
            await tx.agentRecoveryKey.findUnique({
              where: { fingerprint: challenge.fingerprint },
            })
          )
            throw new BadRequestException(
              'Recovery keys cannot be used as device keys',
            );
          installation = await tx.agentInstallation.create({
            data: {
              publicKey: challenge.publicKey,
              fingerprint: challenge.fingerprint,
              agent: {
                create: {
                  name: challenge.name,
                  slug: challenge.slug,
                  status: 'ACTIVE',
                  description: 'Connected Agent',
                  manifestVersion: '2',
                },
              },
            },
            include: { agent: { select: agentDisplay } },
          });
          await tx.agentAccessEvent.create({
            data: {
              agentId: installation.agentId,
              installationId: installation.id,
              action: 'agent.registered',
              details: { fingerprint: installation.fingerprint },
            },
          });
        }
        if (installation.revokedAt || installation.agent.status !== 'ACTIVE')
          throw new UnauthorizedException('Agent or installation is inactive');
        const session = await tx.agentSession.create({
          data: {
            installationId: installation.id,
            tokenHash: hash(token),
            scopes: ['projects:read', 'projects:write', 'agent:manage'],
            expiresAt,
          },
        });
        await tx.agentAccessEvent.create({
          data: {
            agentId: installation.agentId,
            installationId: installation.id,
            action: 'session.created',
            details: { sessionId: session.id },
          },
        });
        return {
          agent: installation.agent,
          installationId: installation.id,
          accessToken: token,
          expiresAt,
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new ConflictException(
          'Agent slug is already taken; use another slug',
        );
      throw error;
    }
  }

  async authenticate(header?: string) {
    const token = header?.startsWith('Bearer aws_')
      ? header.slice(7)
      : undefined;
    if (!token) throw new UnauthorizedException('Agent session required');
    const session = await this.db.agentSession.findUnique({
      where: { tokenHash: hash(token) },
      include: {
        installation: { include: { agent: { select: agentDisplay } } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.installation.revokedAt ||
      session.installation.agent.status !== 'ACTIVE'
    )
      throw new UnauthorizedException('Agent session expired or revoked');
    return {
      id: session.installation.agentId,
      sessionId: session.id,
      installationId: session.installationId,
      scopes: session.scopes,
      agent: session.installation.agent,
    };
  }

  async disconnect(sessionId: string) {
    await this.db.$transaction(async (tx) => {
      const session = await tx.agentSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
        include: { installation: true },
      });
      await tx.agentAccessEvent.create({
        data: {
          agentId: session.installation.agentId,
          installationId: session.installationId,
          action: 'session.disconnected',
          details: { sessionId },
        },
      });
    });
    return { disconnected: true };
  }
}
