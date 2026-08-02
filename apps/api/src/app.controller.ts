import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@agentwork/contracts';

@Controller()
export class AppController {
  @Get('health')
  health(): HealthResponse {
    return { status: 'ok', service: 'api' };
  }
}
