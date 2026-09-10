import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaClient, type Prisma } from '@agentwork/database';
import { createHash, randomBytes, randomUUID, verify } from 'node:crypto';
import {
  agentDisplay,
  machinePublicKey,
  persistChallenge,
} from './access.service';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
@Injectable()
export class DeviceAccessService {
  constructor(@Inject(PrismaClient) private readonly db: PrismaClient) {}

  async claimLegacy(
    authorization: string | undefined,
    input: { agentId: string; challengeId: string; signature: string },
  ) {
    const token = authorization?.startsWith('Bearer awk_')
      ? authorization.slice(7)
      : undefined;
    if (!token)
      throw new UnauthorizedException('A legacy Agent API key is required');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`access:${input.agentId}`}))`;
      const key = await tx.apiKey.findUnique({
        where: { keyHash: hash(token) },
        include: { agent: { select: agentDisplay } },
      });
      if (
        !key ||
        key.agentId !== input.agentId ||
        key.revokedAt ||
        (key.expiresAt && key.expiresAt <= new Date()) ||
        key.agent.status !== 'ACTIVE' ||
        !key.scopes.includes('agent:keys')
      )
        throw new UnauthorizedException(
          'Legacy key cannot authorize identity migration',
        );
      if (await tx.agentInstallation.count({ where: { agentId: key.agentId } }))
        throw new ConflictException(
          'This Agent already has V2 devices; use device authorization or recovery',
        );
      const challenge = await tx.agentChallenge.findUnique({
        where: { id: input.challengeId },
      });
      if (
        !challenge ||
        challenge.purpose !== 'CONNECT' ||
        challenge.consumedAt ||
        challenge.expiresAt <= new Date() ||
        !verify(
          null,
          Buffer.from(challenge.message),
          challenge.publicKey,
          Buffer.from(input.signature, 'base64'),
        )
      )
        throw new UnauthorizedException('Invalid new-device proof');
      if (
        (await tx.agentInstallation.findUnique({
          where: { fingerprint: challenge.fingerprint },
        })) ||
        (await tx.agentRecoveryKey.findUnique({
          where: { fingerprint: challenge.fingerprint },
        }))
      )
        throw new ConflictException('The new device key is already in use');
      const consumed = await tx.agentChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new UnauthorizedException('Device proof was already consumed');
      const device = await tx.agentInstallation.create({
        data: {
          agentId: key.agentId,
          publicKey: challenge.publicKey,
          fingerprint: challenge.fingerprint,
          label: 'Migrated legacy device',
        },
      });
      await tx.apiKey.updateMany({
        where: { agentId: key.agentId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.event(tx, key.agentId, 'device.legacy_migrated', device.id, {
        legacyKeyId: key.id,
        fingerprint: device.fingerprint,
      });
      return { agent: key.agent, installationId: device.id, migrated: true };
    });
  }

  private async active(
    tx: Prisma.TransactionClient,
    agentId: string,
    installationId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`access:${agentId}`}))`;
    if (
      !(await tx.agentInstallation.findFirst({
        where: {
          id: installationId,
          agentId,
          revokedAt: null,
          agent: { status: 'ACTIVE' },
        },
      }))
    )
      throw new UnauthorizedException('Device is no longer active');
  }
  private event(
    tx: Prisma.TransactionClient,
    agentId: string,
    action: string,
    installationId: string | null,
    details: Prisma.InputJsonValue = {},
  ) {
    return tx.agentAccessEvent.create({
      data: { agentId, action, installationId, details },
    });
  }

  async devices(agentId: string, installationId: string) {
    const devices = await this.db.agentInstallation.findMany({
      where: { agentId },
      select: {
        id: true,
        label: true,
        fingerprint: true,
        createdAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return devices.map((device) => ({
      ...device,
      current: device.id === installationId,
    }));
  }
  async authorize(
    agentId: string,
    installationId: string,
    input: { publicKey: string; label: string },
  ) {
    const publicKey = machinePublicKey(input.publicKey);
    const fingerprint = hash(publicKey);
    return this.db.$transaction(async (tx) => {
      await this.active(tx, agentId, installationId);
      if (await tx.agentRecoveryKey.findUnique({ where: { fingerprint } }))
        throw new BadRequestException(
          'Recovery keys cannot be enrolled as device keys',
        );
      const existing = await tx.agentInstallation.findUnique({
        where: { fingerprint },
      });
      if (existing) {
        if (existing.agentId !== agentId || existing.revokedAt)
          throw new ConflictException(
            'Device key is already bound or revoked; generate a new key',
          );
        return {
          id: existing.id,
          agentId,
          fingerprint,
          alreadyAuthorized: true,
        };
      }
      const device = await tx.agentInstallation.create({
        data: { agentId, publicKey, fingerprint, label: input.label },
      });
      await this.event(tx, agentId, 'device.authorized', installationId, {
        deviceId: device.id,
        fingerprint,
      });
      return { id: device.id, agentId, fingerprint };
    });
  }
  async revokeDevice(
    agentId: string,
    installationId: string,
    targetId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      await this.active(tx, agentId, installationId);
      const result = await tx.agentInstallation.updateMany({
        where: { id: targetId, agentId },
        data: { revokedAt: new Date() },
      });
      if (!result.count)
        throw new BadRequestException('Device does not belong to this Agent');
      await tx.agentSession.updateMany({
        where: { installationId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.event(tx, agentId, 'device.revoked', installationId, {
        deviceId: targetId,
      });
      return { revoked: true, deviceId: targetId };
    });
  }
  async recoveryStatus(agentId: string) {
    const key = await this.db.agentRecoveryKey.findUnique({
      where: { agentId },
      select: { fingerprint: true, updatedAt: true },
    });
    return { configured: !!key, ...key };
  }
  async setupRecovery(
    agentId: string,
    installationId: string,
    input: { publicKey: string; replace: boolean },
  ) {
    const publicKey = machinePublicKey(input.publicKey);
    const fingerprint = hash(publicKey);
    return this.db.$transaction(async (tx) => {
      await this.active(tx, agentId, installationId);
      if (await tx.agentInstallation.findUnique({ where: { fingerprint } }))
        throw new BadRequestException(
          'Use an independent recovery key, not a device key',
        );
      const existing = await tx.agentRecoveryKey.findUnique({
        where: { agentId },
      });
      if (existing?.fingerprint === fingerprint)
        return { configured: true, fingerprint };
      if (existing && !input.replace)
        throw new ConflictException(
          'Recovery is already configured; explicitly rotate it to replace the key',
        );
      const reused = await tx.agentRecoveryKey.findUnique({
        where: { fingerprint },
      });
      if (reused && reused.agentId !== agentId)
        throw new ConflictException('Recovery key is already in use');
      await tx.agentRecoveryKey.upsert({
        where: { agentId },
        create: { agentId, publicKey, fingerprint },
        update: { publicKey, fingerprint },
      });
      await this.event(tx, agentId, 'recovery.configured', installationId, {
        fingerprint,
        rotated: !!existing,
      });
      return { configured: true, fingerprint };
    });
  }
  async challenge(
    input: { agentId: string; publicKey: string },
    source: string,
  ) {
    const publicKey = machinePublicKey(input.publicKey);
    const fingerprint = hash(publicKey);
    const agent = await this.db.agent.findFirst({
      where: { id: input.agentId, status: 'ACTIVE' },
      include: { recoveryKey: true },
    });
    if (!agent?.recoveryKey)
      throw new UnauthorizedException('Recovery is unavailable');
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 300_000);
    const message = JSON.stringify({
      protocol: 'agentwork-recovery-v2',
      audience: process.env.AGENTWORK_ORIGIN ?? 'http://localhost:3001',
      challengeId: id,
      agentId: agent.id,
      fingerprint,
      recoveryFingerprint: agent.recoveryKey.fingerprint,
      nonce: randomBytes(32).toString('base64url'),
      expiresAt: expiresAt.toISOString(),
    });
    await persistChallenge(
      this.db,
      {
        id,
        publicKey,
        fingerprint,
        name: agent.name,
        slug: agent.slug,
        message,
        expiresAt,
        purpose: 'RECOVERY',
        agentId: agent.id,
        recoveryFingerprint: agent.recoveryKey.fingerprint,
      },
      source,
    );
    return { challengeId: id, message, expiresAt };
  }
  async recover(input: {
    challengeId: string;
    recoverySignature: string;
    deviceSignature: string;
  }) {
    const challenge = await this.db.agentChallenge.findUnique({
      where: { id: input.challengeId },
    });
    if (
      !challenge?.agentId ||
      challenge.purpose !== 'RECOVERY' ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date()
    )
      throw new UnauthorizedException(
        'Recovery challenge expired or already consumed',
      );
    const agentId = challenge.agentId;
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`access:${agentId}`}))`;
      const key = await tx.agentRecoveryKey.findUnique({
        where: { agentId },
        include: { agent: { select: agentDisplay } },
      });
      if (
        !key ||
        key.agent.status !== 'ACTIVE' ||
        key.fingerprint !== challenge.recoveryFingerprint ||
        !verify(
          null,
          Buffer.from(challenge.message),
          key.publicKey,
          Buffer.from(input.recoverySignature, 'base64'),
        ) ||
        !verify(
          null,
          Buffer.from(challenge.message),
          challenge.publicKey,
          Buffer.from(input.deviceSignature, 'base64'),
        )
      )
        throw new UnauthorizedException(
          'Invalid recovery proof or rotated recovery key',
        );
      if (challenge.fingerprint === key.fingerprint)
        throw new BadRequestException(
          'Recovery and device keys must be distinct',
        );
      const existing = await tx.agentInstallation.findUnique({
        where: { fingerprint: challenge.fingerprint },
      });
      if (existing && existing.agentId !== agentId)
        throw new ConflictException(
          'Replacement device belongs to another Agent',
        );
      const consumed = await tx.agentChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new UnauthorizedException('Recovery challenge already consumed');
      const device = await tx.agentInstallation.upsert({
        where: { fingerprint: challenge.fingerprint },
        create: {
          agentId,
          publicKey: challenge.publicKey,
          fingerprint: challenge.fingerprint,
          label: 'Recovered device',
        },
        update: { revokedAt: null },
      });
      await tx.agentInstallation.updateMany({
        where: { agentId, id: { not: device.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.agentSession.updateMany({
        where: { installation: { agentId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.apiKey.updateMany({
        where: { agentId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.event(tx, agentId, 'recovery.completed', device.id, {
        recoveryFingerprint: key.fingerprint,
        replacementFingerprint: device.fingerprint,
      });
      return { agent: key.agent, installationId: device.id, recovered: true };
    });
  }
}
