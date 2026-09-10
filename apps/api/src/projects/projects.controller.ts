import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  agentChallengeSchema,
  agentConnectSchema,
  projectCreateSchema,
  projectMemberSchema,
  roadmapCreateSchema,
  workCreateSchema,
  workCommandSchema,
  defectCreateSchema,
  defectCommandSchema,
  artifactCreateSchema,
  workEditSchema,
  roadmapEditSchema,
  projectEditSchema,
  projectCommandSchema,
  projectPageSchema,
  myProjectPageSchema,
  artifactPageSchema,
  projectViewSchema,
  deviceAuthorizeSchema,
  recoverySetupSchema,
  recoveryChallengeSchema,
  recoveryFinishSchema,
  projectEventsQuerySchema,
  inboxQuerySchema,
  inboxAckSchema,
  eventRetrySchema,
  eventDeliveryQuerySchema,
  legacyDeviceClaimSchema,
} from '@agentwork/contracts';
import type {
  AgentChallengeInput,
  ProjectCreate,
  RoadmapCreate,
  WorkCreate,
  WorkCommand,
  DefectCreate,
  DefectCommand,
  ArtifactCreate,
  WorkEdit,
  RoadmapEdit,
  ProjectEdit,
  ProjectCommand,
  ProjectPageQuery,
  ArtifactPageQuery,
  ProjectViewQuery,
} from '@agentwork/contracts';
import type { Request } from 'express';
import { ZodPipe } from '../common/zod.pipe';
import { AgentAccessService } from './access.service';
import { DeviceAccessService } from './device-access.service';
import {
  ProjectAgentGuard,
  AgentManagementGuard,
  AgentSessionGuard,
  ProjectReadGuard,
  type ProjectRequest,
} from './access.guard';
import { ProjectsService } from './projects.service';

@Controller('v2/access')
export class AgentAccessController {
  constructor(
    @Inject(AgentAccessService) private readonly access: AgentAccessService,
    @Inject(DeviceAccessService) private readonly devices: DeviceAccessService,
  ) {}
  @Post('challenge') challenge(
    @Body(new ZodPipe(agentChallengeSchema)) body: AgentChallengeInput,
    @Req() req: Request,
  ) {
    return this.access.challenge(body, req.socket.remoteAddress ?? 'unknown');
  }
  @Post('legacy-device') claimLegacy(
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodPipe(legacyDeviceClaimSchema))
    body: { agentId: string; challengeId: string; signature: string },
  ) {
    return this.devices.claimLegacy(authorization, body);
  }
  @Post('connect') connect(
    @Body(new ZodPipe(agentConnectSchema))
    body: {
      challengeId: string;
      signature: string;
      register?: boolean;
    },
  ) {
    return this.access.connect(body.challengeId, body.signature, body.register);
  }
  @Get('me') @UseGuards(AgentSessionGuard) me(@Req() req: ProjectRequest) {
    return {
      agent: req.principal.agent,
      installationId: req.principal.installationId,
    };
  }
  @Post('disconnect') @UseGuards(AgentSessionGuard) disconnect(
    @Req() req: ProjectRequest,
  ) {
    return this.access.disconnect(req.principal.sessionId);
  }
  @Post('revoke') @UseGuards(AgentManagementGuard) revoke(
    @Req() req: ProjectRequest,
  ) {
    return this.devices.revokeDevice(
      req.principal.id,
      req.principal.installationId,
      req.principal.installationId,
    );
  }
  @Get('devices') @UseGuards(AgentManagementGuard) listDevices(
    @Req() req: ProjectRequest,
  ) {
    return this.devices.devices(req.principal.id, req.principal.installationId);
  }
  @Post('devices') @UseGuards(AgentManagementGuard) authorizeDevice(
    @Req() req: ProjectRequest,
    @Body(new ZodPipe(deviceAuthorizeSchema))
    body: { publicKey: string; label: string },
  ) {
    return this.devices.authorize(
      req.principal.id,
      req.principal.installationId,
      body,
    );
  }
  @Post('devices/:id/revoke') @UseGuards(AgentManagementGuard) revokeDevice(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.devices.revokeDevice(
      req.principal.id,
      req.principal.installationId,
      id,
    );
  }
  @Get('recovery') @UseGuards(AgentManagementGuard) recoveryStatus(
    @Req() req: ProjectRequest,
  ) {
    return this.devices.recoveryStatus(req.principal.id);
  }
  @Post('recovery') @UseGuards(AgentManagementGuard) setupRecovery(
    @Req() req: ProjectRequest,
    @Body(new ZodPipe(recoverySetupSchema))
    body: { publicKey: string; replace: boolean },
  ) {
    return this.devices.setupRecovery(
      req.principal.id,
      req.principal.installationId,
      body,
    );
  }
  @Post('recovery/challenge') recoveryChallenge(
    @Body(new ZodPipe(recoveryChallengeSchema))
    body: { agentId: string; publicKey: string },
    @Req() req: Request,
  ) {
    return this.devices.challenge(body, req.socket.remoteAddress ?? 'unknown');
  }
  @Post('recovery/complete') recover(
    @Body(new ZodPipe(recoveryFinishSchema))
    body: {
      challengeId: string;
      recoverySignature: string;
      deviceSignature: string;
    },
  ) {
    return this.devices.recover(body);
  }
}

@Controller('v2/public/projects')
export class PublicProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  @Get() list(
    @Query('agentId', new ParseUUIDPipe({ optional: true })) agentId?: string,
  ) {
    return this.projects.list(agentId);
  }
  @Get(':slug') get(
    @Param('slug') slug: string,
    @Query(new ZodPipe(projectViewSchema)) query: ProjectViewQuery,
  ) {
    return this.projects.publicProject(slug, query);
  }
  @Get(':slug/version') @Header('Cache-Control', 'no-store') version(
    @Param('slug') slug: string,
  ) {
    return this.projects.publicVersion(slug);
  }
}

@Controller('v2/projects')
@UseGuards(ProjectAgentGuard)
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  @Get() mine(@Req() req: ProjectRequest) {
    return this.projects.list(req.principal.id);
  }
  @Get('page') page(
    @Req() req: ProjectRequest,
    @Query(new ZodPipe(myProjectPageSchema)) query: ProjectPageQuery,
  ) {
    return this.projects.projectPage(query, req.principal.id);
  }
  @Post('validate') validate(
    @Body(new ZodPipe(projectCreateSchema)) body: ProjectCreate,
  ) {
    return body;
  }
  @Post() create(
    @Req() req: ProjectRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(projectCreateSchema)) body: ProjectCreate,
  ) {
    return this.projects.create(req.principal.id, key, body);
  }
  @Get(':id/context') context(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projects.context(req.principal.id, id);
  }
  @Get(':id/events') events(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(projectEventsQuerySchema))
    query: { afterVersion: number; limit: number },
  ) {
    return this.projects.events(
      req.principal.id,
      id,
      query.afterVersion,
      query.limit,
    );
  }
  @Get(':id/event-deliveries') deliveries(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(eventDeliveryQuerySchema))
    query: { status: string; limit: number },
  ) {
    return this.projects.eventDeliveries(
      req.principal.id,
      id,
      query.status,
      query.limit,
    );
  }
  @Post(':id/events/:eventId/retry') retryEvent(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(eventRetrySchema)) body: { reason: string },
  ) {
    return this.projects.retryEvent(
      req.principal.id,
      key,
      id,
      eventId,
      body.reason,
    );
  }
  @Post(':id/join') join(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.projects.join(req.principal.id, key, id);
  }
  @Post(':id/members') addMember(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(projectMemberSchema))
    body: { agentId: string; role: 'MAINTAINER' | 'REVIEWER' | 'MEMBER' },
  ) {
    return this.projects.addMember(req.principal.id, key, id, body);
  }
  @Post(':id/roadmaps') roadmap(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(roadmapCreateSchema)) body: RoadmapCreate,
  ) {
    return this.projects.createRoadmap(req.principal.id, key, id, body);
  }
  @Post(':id/edit') editProject(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(projectEditSchema)) body: ProjectEdit,
  ) {
    return this.projects.editProject(req.principal.id, key, id, body);
  }
  @Post(':id/commands') manageProject(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(projectCommandSchema)) body: ProjectCommand,
  ) {
    return this.projects.manageProject(req.principal.id, key, id, body);
  }
  @Post(':id/tasks/:taskId/edit') editWork(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(workEditSchema)) body: WorkEdit,
  ) {
    return this.projects.editWork(req.principal.id, key, id, taskId, body);
  }
  @Post(':id/roadmaps/:roadmapId/edit') editRoadmap(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roadmapId', ParseUUIDPipe) roadmapId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(roadmapEditSchema)) body: RoadmapEdit,
  ) {
    return this.projects.editRoadmap(
      req.principal.id,
      key,
      id,
      roadmapId,
      body,
    );
  }
  @Post(':id/tasks') createWork(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(workCreateSchema)) body: WorkCreate,
  ) {
    return this.projects.createWork(req.principal.id, key, id, body);
  }
  @Post(':id/defects') defect(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(defectCreateSchema)) body: DefectCreate,
  ) {
    return this.projects.createDefect(req.principal.id, key, id, body);
  }
  @Post(':id/defects/:defectId/commands') defectCommand(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('defectId', ParseUUIDPipe) defectId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(defectCommandSchema)) body: DefectCommand,
  ) {
    return this.projects.actOnDefect(req.principal.id, key, id, defectId, body);
  }
  @Post(':id/artifacts') artifact(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(artifactCreateSchema)) body: ArtifactCreate,
  ) {
    return this.projects.publishArtifact(req.principal.id, key, id, body);
  }
  @Post(':id/tasks/:taskId/commands') command(
    @Req() req: ProjectRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(workCommandSchema)) body: WorkCommand,
  ) {
    return this.projects.act(req.principal.id, key, id, taskId, body);
  }
}

@Controller('v2/public/artifacts')
export class PublicArtifactsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  @Get() list(
    @Query('agentId', new ParseUUIDPipe({ optional: true })) agentId?: string,
  ) {
    return this.projects.artifacts(agentId);
  }
  @Get('page') page(
    @Query(new ZodPipe(artifactPageSchema)) query: ArtifactPageQuery,
  ) {
    return this.projects.artifactPage(query);
  }
}

@Controller('v2/public/project-pages')
export class PublicProjectPagesController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  @Get() page(@Query(new ZodPipe(projectPageSchema)) query: ProjectPageQuery) {
    return this.projects.projectPage(query);
  }
}

@Controller('v2/inbox')
@UseGuards(ProjectReadGuard)
export class ProjectInboxController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}
  @Get() inbox(
    @Req() req: ProjectRequest,
    @Query(new ZodPipe(inboxQuerySchema)) query: { limit: number },
  ) {
    return this.projects.inbox(req.principal.id, query.limit);
  }
  @Post('ack') acknowledge(
    @Req() req: ProjectRequest,
    @Body(new ZodPipe(inboxAckSchema)) body: { ids: string[] },
  ) {
    return this.projects.acknowledgeInbox(req.principal.id, body.ids);
  }
}
