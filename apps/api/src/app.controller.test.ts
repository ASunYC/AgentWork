import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { healthResponseSchema } from '@agentwork/contracts';
import { AppModule } from './app.module';
import { AppController } from './app.controller';

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('disables legacy human writes in the default V2 application', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await request(app.getHttpServer())
      .post('/v1/identity/register')
      .send({ email: 'test@example.com', password: 'not-a-real-password' })
      .expect(403);
    await request(app.getHttpServer()).post('/v1/tasks').send({}).expect(403);
  });
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
    const stack = app.getHttpAdapter().getInstance()._router.stack as {
      route?: { path: string; methods: Record<string, boolean> };
    }[];
    for (const layer of stack) {
      if (!layer.route?.path.startsWith('/v2/')) continue;
      const path = layer.route.path.replace(/:([^/]+)/g, '{$1}');
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled)
          expect(
            response.body.paths[path]?.[method]?.operationId,
            `${method} ${path} must be documented`,
          ).toBeTypeOf('string');
      }
    }
    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.paths).toHaveProperty('/v1/agents/verify.post');
    expect(response.body.paths).toHaveProperty('/v1/tasks/{id}/accept.post');
    expect(response.body.paths).toHaveProperty(
      '/v1/admin/webhook-deliveries/{id}/replay.post',
    );
    const task =
      response.body.paths['/v2/projects/{id}/tasks/{taskId}/commands'].post;
    expect(
      task.requestBody.content['application/json'].schema.required,
    ).toContain('expectedVersion');
    expect(
      task.requestBody.content['application/json'].schema.properties.action
        .enum,
    ).toContain('claim');
    expect(
      task.requestBody.content['application/json'].schema.allOf,
    ).toContainEqual({
      if: {
        properties: { action: { enum: ['submit'] } },
        required: ['action'],
      },
      then: { required: ['reason', 'evidenceUrl'] },
    });
    expect(
      task.parameters.some(
        (parameter: { name: string; in: string; required: boolean }) =>
          parameter.name === 'Idempotency-Key' &&
          parameter.in === 'header' &&
          parameter.required,
      ),
    ).toBe(true);
    expect(
      response.body.paths['/v2/access/recovery'].post['x-agent-scopes'],
    ).toEqual(['agent:manage']);
    expect(
      response.body.paths['/v2/public/project-pages'].get.parameters.some(
        (parameter: { name: string }) => parameter.name === 'cursor',
      ),
    ).toBe(true);
    expect(
      response.body.paths['/v2/public/projects/{slug}'].get.responses['200']
        .content['application/json'].schema.properties.gitUrl,
    ).toBeUndefined();
    expect(
      response.body.components.responses.Error.content['application/json']
        .schema.required,
    ).toContain('request_id');
  });
});

describe('readiness', () => {
  it('reports unavailable when PostgreSQL cannot be queried', async () => {
    const controller = new AppController({
      $queryRaw: async () => {
        throw new Error('offline');
      },
    } as never);
    await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
  });
});
