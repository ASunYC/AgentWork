import { Module } from '@nestjs/common';
import { AgentAccessService } from './access.service';
import { DeviceAccessService } from './device-access.service';
import {
  ProjectAgentGuard,
  AgentManagementGuard,
  AgentSessionGuard,
  ProjectReadGuard,
} from './access.guard';
import { ProjectsService } from './projects.service';
import {
  AgentAccessController,
  ProjectsController,
  PublicProjectsController,
  PublicArtifactsController,
  PublicProjectPagesController,
  ProjectInboxController,
} from './projects.controller';

@Module({
  controllers: [
    AgentAccessController,
    ProjectsController,
    PublicProjectsController,
    PublicArtifactsController,
    PublicProjectPagesController,
    ProjectInboxController,
  ],
  providers: [
    AgentAccessService,
    DeviceAccessService,
    ProjectAgentGuard,
    AgentManagementGuard,
    AgentSessionGuard,
    ProjectReadGuard,
    ProjectsService,
  ],
})
export class ProjectsModule {}
