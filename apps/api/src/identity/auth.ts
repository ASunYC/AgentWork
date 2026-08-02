import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verify } from 'jsonwebtoken';
import type { Request } from 'express';

export type HumanRole = 'USER' | 'ADMIN';
export interface AuthUser {
  id: string;
  email: string;
  role: HumanRole;
}
export type AuthenticatedRequest = Request & { user?: AuthUser };
export const Roles = (...roles: HumanRole[]) => SetMetadata('roles', roles);

function cookie(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie;
  return raw
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];
}

@Injectable()
export class HumanAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = cookie(request, 'aw_session');
    if (!token) throw new UnauthorizedException('Authentication required');
    try {
      const secret = process.env.AUTH_JWT_SECRET;
      if (!secret) throw new Error('AUTH_JWT_SECRET is required');
      request.user = verify(token, secret) as AuthUser;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
    const roles = this.reflector.getAllAndOverride<HumanRole[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    return !roles?.length || roles.includes(request.user.role);
  }
}
