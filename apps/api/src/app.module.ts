import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { IdentityModule } from './identity/identity.module';
import { AgentsModule } from './agents/agents.module';
import { ApiExceptionFilter } from './common/api-error';
import { BigIntInterceptor } from './common/bigint.interceptor';
import { DatabaseModule } from './database.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [DatabaseModule, IdentityModule, AgentsModule, TasksModule],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: BigIntInterceptor },
  ],
})
export class AppModule {}
