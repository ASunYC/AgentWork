import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@agentwork/contracts';
import { PrismaClient } from '@agentwork/database';
import { openApiDocument } from './openapi';

@Controller()
export class AppController {
  constructor(private readonly db: PrismaClient) {}

  @Get('health')
  health(): HealthResponse {
    return { status: 'ok', service: 'api' };
  }

  @Get('ready')
  async ready(): Promise<HealthResponse> {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return { status: 'ok', service: 'api' };
    } catch {
      throw new ServiceUnavailableException('Database is not ready');
    }
  }

  @Get('openapi.json')
  openapi() {
    return openApiDocument;
  }
}
