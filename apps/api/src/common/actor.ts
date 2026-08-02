import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@agentwork/database';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { verify } from 'jsonwebtoken';
import { PRISMA } from './database';
import type { AuthUser } from '../identity/auth';

export type ActorContext = {
  type: 'USER' | 'AGENT';
  id: string;
  requestId: string;
};

type ActorRequest = Request & {
  actor?: ActorContext;
  user?: AuthUser;
  agent?: { id: string; slug: string; scopes: string[] };
};

function cookie(request: Request, name: string): string | undefined {
  return request.headers.cookie
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];
}

@Injectable()
export class ActorAuthGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const requestId = request.header('x-request-id') ?? crypto.randomUUID();
    const session = cookie(request, 'aw_session');
    if (session) {
      const secret = process.env.AUTH_JWT_SECRET;
      if (!secret) throw new Error('AUTH_JWT_SECRET is required');
      try {
        request.user = verify(session, secret) as AuthUser;
        request.actor = { type: 'USER', id: request.user.id, requestId };
        return true;
      } catch {
        throw new UnauthorizedException('Invalid or expired session');
      }
    }
    const authorization = request.headers.authorization;
    const plain = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : undefined;
    if (plain?.startsWith('awk_')) {
      const key = await this.db.apiKey.findUnique({
        where: { keyHash: createHash('sha256').update(plain).digest('hex') },
        include: { agent: true },
      });
      if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date()) || key.agent.status === 'SUSPENDED')
        throw new UnauthorizedException('Invalid or revoked Agent API key');
      request.agent = { id: key.agent.id, slug: key.agent.slug, scopes: key.scopes };
      request.actor = { type: 'AGENT', id: key.agent.id, requestId };
      return true;
    }
    throw new UnauthorizedException('Authenticated user or Agent required');
  }
}

/**
 * Temporary HTTP adapter. Production MUST replace header parsing with an authentication
 * guard that assigns a verified ActorContext to request.actor. Domain services never read headers.
 */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActorContext => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { actor?: ActorContext }>();
    if (request.actor) return request.actor;
    const trusted = request as Request & {
      user?: AuthUser;
      agent?: { id: string };
    };
    if (trusted.user)
      return { type: 'USER', id: trusted.user.id, requestId: request.header('x-request-id') ?? crypto.randomUUID() };
    if (trusted.agent)
      return { type: 'AGENT', id: trusted.agent.id, requestId: request.header('x-request-id') ?? crypto.randomUUID() };
    throw new UnauthorizedException('Authenticated actor is required');
  },
);
