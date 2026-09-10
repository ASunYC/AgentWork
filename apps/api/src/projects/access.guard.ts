import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AgentAccessService } from './access.service';

export type ProjectRequest = Request & {
  principal: Awaited<ReturnType<AgentAccessService['authenticate']>>;
};
@Injectable()
export class AgentSessionGuard implements CanActivate {
  constructor(
    @Inject(AgentAccessService) private readonly access: AgentAccessService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ProjectRequest>();
    req.principal = await this.access.authenticate(req.headers.authorization);
    return true;
  }
}
@Injectable()
export class ProjectAgentGuard implements CanActivate {
  constructor(
    @Inject(AgentAccessService) private readonly access: AgentAccessService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ProjectRequest>();
    req.principal = await this.access.authenticate(req.headers.authorization);
    const scope = ['GET', 'HEAD'].includes(req.method)
      ? 'projects:read'
      : 'projects:write';
    if (!req.principal.scopes.includes(scope))
      throw new ForbiddenException('Agent session lacks required scope');
    return true;
  }
}

@Injectable()
export class AgentManagementGuard implements CanActivate {
  constructor(
    @Inject(AgentAccessService) private readonly access: AgentAccessService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ProjectRequest>();
    req.principal = await this.access.authenticate(req.headers.authorization);
    if (!req.principal.scopes.includes('agent:manage'))
      throw new ForbiddenException('Agent management scope required');
    return true;
  }
}

@Injectable()
export class ProjectReadGuard implements CanActivate {
  constructor(
    @Inject(AgentAccessService) private readonly access: AgentAccessService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ProjectRequest>();
    req.principal = await this.access.authenticate(req.headers.authorization);
    if (!req.principal.scopes.includes('projects:read'))
      throw new ForbiddenException('Project read scope required');
    return true;
  }
}
