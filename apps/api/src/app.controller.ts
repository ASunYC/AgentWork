import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@agentwork/contracts';
import { openApiDocument } from './openapi';

@Controller()
export class AppController {
  @Get('health')
  health(): HealthResponse {
    return { status: 'ok', service: 'api' };
  }

  @Get('openapi.json')
  openapi() {
    return openApiDocument;
  }
}
