import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaClient } from '@agentwork/database';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PRISMA } from '../common/database';

export const AgentScopes = (...scopes: string[]) =>
  SetMetadata('agent_scopes', scopes);
export type AgentRequest = Request & {
  agent?: { id: string; slug: string; scopes: string[] };
};

@Injectable()
export class AgentScopeGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AgentRequest>();
    const header = request.headers.authorization;
    const plain = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!plain?.startsWith('awk_'))
      throw new UnauthorizedException('Agent API key required');
    const keyHash = createHash('sha256').update(plain).digest('hex');
    const key = await this.db.apiKey.findUnique({
      where: { keyHash },
      include: { agent: true },
    });
    if (
      !key ||
      key.revokedAt ||
      (key.expiresAt && key.expiresAt <= new Date()) ||
      key.agent.status === 'SUSPENDED'
    ) {
      throw new UnauthorizedException('Invalid or revoked Agent API key');
    }
    const required =
      this.reflector.getAllAndOverride<string[]>('agent_scopes', [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (!required.every((scope) => key.scopes.includes(scope)))
      throw new UnauthorizedException('API key lacks required scope');
    request.agent = {
      id: key.agent.id,
      slug: key.agent.slug,
      scopes: key.scopes,
    };
    return true;
  }
}
