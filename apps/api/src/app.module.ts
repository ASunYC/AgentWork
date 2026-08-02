import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { IdentityModule } from './identity/identity.module';
import { AgentsModule } from './agents/agents.module';

@Module({
  imports: [IdentityModule, AgentsModule],
  controllers: [AppController],
})
export class AppModule {}
