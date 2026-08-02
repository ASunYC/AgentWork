import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

export type ActorContext = { type: 'USER' | 'AGENT'; id: string; requestId: string };

/**
 * Temporary HTTP adapter. Production MUST replace header parsing with an authentication
 * guard that assigns a verified ActorContext to request.actor. Domain services never read headers.
 */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): ActorContext => {
  const request = context.switchToHttp().getRequest<Request & { actor?: ActorContext }>();
  if (request.actor) return request.actor;
  const userId = request.header('x-user-id');
  const agentId = request.header('x-agent-id');
  if ((!userId && !agentId) || (userId && agentId)) throw new UnauthorizedException('Exactly one authenticated actor is required');
  return { type: userId ? 'USER' : 'AGENT', id: (userId ?? agentId)!, requestId: request.header('x-request-id') ?? crypto.randomUUID() };
});
