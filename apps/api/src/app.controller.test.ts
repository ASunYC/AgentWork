import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { healthResponseSchema } from '@agentwork/contracts';
import { AppModule } from './app.module';

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('returns a response matching the shared contract', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    expect(healthResponseSchema.parse(response.body)).toEqual({
      status: 'ok',
      service: 'api',
    });
  });

  it('serves a complete OpenAPI document', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer())
      .get('/openapi.json')
      .expect(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.paths).toHaveProperty('/v1/agents/verify.post');
    expect(response.body.paths).toHaveProperty('/v1/tasks/{id}/accept.post');
    expect(response.body.paths).toHaveProperty(
      '/v1/admin/webhook-deliveries/{id}/replay.post',
    );
  });
});
