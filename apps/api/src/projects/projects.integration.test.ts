import 'reflect-metadata';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import {
  PrismaClient,
  ProjectEventEngine,
  type Prisma,
  type ProjectEventJob,
} from '@agentwork/database';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProjectsModule } from './projects.module';
import { DatabaseModule } from '../common/database';
import { ApiExceptionFilter } from '../common/api-error';
import { AgentAccessService } from './access.service';
import { LegacyWriteGuard } from '../common/legacy-write.guard';
import { openApiDocument } from '../openapi';
import { v2Operations } from '../openapi-v2';
import {
  errorV2Schema,
  projectContextV2Schema,
  projectDetailV2Schema,
  projectPageV2Schema,
  artifactPageV2Schema,
  inboxV2Schema,
  projectEventsV2Schema,
} from '@agentwork/contracts';

const exec = promisify(execFile);
let container: StartedPostgreSqlContainer;
let db: PrismaClient;
let app: INestApplication;
let access: AgentAccessService;
const idempotency = () => randomUUID();

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();
  await exec(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: resolve(__dirname, '../../../../packages/database'),
      env: { ...process.env, DATABASE_URL: url },
    },
  );
  db = new PrismaClient({ datasources: { db: { url } } });
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, ProjectsModule],
  })
    .overrideProvider(PrismaClient)
    .useValue(db)
    .compile();
  app = module.createNestApplication();
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalGuards(new LegacyWriteGuard());
  await app.listen(0, '127.0.0.1');
  process.env.AGENTWORK_ORIGIN = await app.getUrl();
  access = module.get(AgentAccessService);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  // Independent cases share the test database but must not share the public
  // endpoint's one-minute IP quota. Replay/expiry checks remain within each case.
  await db.agentChallenge.deleteMany();
});

async function identity() {
  const keys = generateKeyPairSync('ed25519');
  const slug = `agent-${randomUUID()}`;
  const input = {
    name: 'Test Agent',
    slug,
    publicKey: keys.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString(),
  };
  const challenge = await access.challenge(input, randomUUID());
  const signature = sign(
    null,
    Buffer.from(challenge.message),
    keys.privateKey,
  ).toString('base64');
  const result = await request(app.getHttpServer())
    .post('/v2/access/connect')
    .send({ challengeId: challenge.challengeId, signature })
    .expect(201);
  return { ...result.body, input, keys, challenge, signature } as {
    agent: { id: string };
    accessToken: string;
    installationId: string;
    input: typeof input;
    keys: typeof keys;
    challenge: typeof challenge;
    signature: string;
  };
}
const post = (path: string, token: string, body: object, key = idempotency()) =>
  request(app.getHttpServer())
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send(body)
    .expect((response) => {
      if (response.status >= 400) {
        errorV2Schema.parse(response.body);
        return;
      }
      const segments = path.split('/');
      const route = Object.entries(openApiDocument.paths).find(
        ([candidate, methods]) => {
          const parts = candidate.split('/');
          return (
            !!methods.post &&
            parts.length === segments.length &&
            parts.every(
              (part, index) => part.startsWith('{') || part === segments[index],
            )
          );
        },
      );
      if (!route) throw new Error(`No documented POST route for ${path}`);
      const operationId = (route[1].post as { operationId: string })
        .operationId;
      v2Operations[operationId]!.response.parse(response.body);
    });
const projectInput = () => ({
  name: 'Integration project',
  slug: `project-${randomUUID()}`,
  description: 'Real database acceptance',
  categories: ['DEVELOPMENT', 'DESIGN'],
  gitUrl: 'git@github.com:example/private.git',
  joinPolicy: 'OPEN',
});

describe.sequential('V2 project collaboration on PostgreSQL', () => {
  it('enforces the public connection quota for repeated requests from one source', async () => {
    const keys = generateKeyPairSync('ed25519');
    const body = {
      name: 'Quota test',
      slug: 'quota-test',
      publicKey: keys.publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString(),
    };
    for (let n = 0; n < 10; n++)
      await request(app.getHttpServer())
        .post('/v2/access/challenge')
        .send(body)
        .expect(201);
    await request(app.getHttpServer())
      .post('/v2/access/challenge')
      .send(body)
      .expect(429);
  });
  it('migrates a legacy Agent through a scoped credential and new-device proof without changing identity', async () => {
    const user = await db.user.create({
      data: {
        email: `legacy-${randomUUID()}@example.test`,
        passwordHash: 'test-only',
        status: 'ACTIVE',
      },
    });
    const agent = await db.agent.create({
      data: {
        ownerUserId: user.id,
        slug: `legacy-${randomUUID()}`,
        name: 'Legacy Agent',
        status: 'ACTIVE',
        manifestVersion: '1',
      },
    });
    const legacyToken = `awk_${randomUUID()}`;
    const readToken = `awk_${randomUUID()}`;
    const key = await db.apiKey.create({
      data: {
        agentId: agent.id,
        keyHash: createHash('sha256').update(legacyToken).digest('hex'),
        scopes: ['agent:keys'],
      },
    });
    await db.apiKey.create({
      data: {
        agentId: agent.id,
        keyHash: createHash('sha256').update(readToken).digest('hex'),
        scopes: ['agent:read'],
      },
    });
    const device = generateKeyPairSync('ed25519');
    const challenge = await access.challenge(
      {
        name: 'New device',
        slug: `device-${randomUUID()}`,
        publicKey: device.publicKey
          .export({ type: 'spki', format: 'pem' })
          .toString(),
      },
      randomUUID(),
    );
    const input = {
      agentId: agent.id,
      challengeId: challenge.challengeId,
      signature: sign(
        null,
        Buffer.from(challenge.message),
        device.privateKey,
      ).toString('base64'),
    };
    await post('/v2/access/legacy-device', readToken, input).expect(401);
    await post('/v2/access/legacy-device', legacyToken, {
      ...input,
      agentId: randomUUID(),
    }).expect(401);
    const directory = await mkdtemp(
      resolve(tmpdir(), 'agentwork-legacy-claim-'),
    );
    try {
      const file = resolve(directory, 'legacy-key');
      await writeFile(file, legacyToken);
      const cli = resolve(__dirname, '../../../../packages/cli/src/cli.mjs');
      const run = async () =>
        JSON.parse(
          (
            await exec(
              process.execPath,
              [
                cli,
                'migrate-legacy',
                '--agent-id',
                agent.id,
                '--legacy-key-file',
                file,
                '--url',
                process.env.AGENTWORK_ORIGIN!,
              ],
              {
                env: {
                  ...process.env,
                  AGENTWORK_HOME: resolve(directory, 'profile'),
                },
                windowsHide: true,
              },
            )
          ).stdout,
        );
      const claimed = await run();
      expect(claimed.agent.id).toBe(agent.id);
      expect(claimed.migrated).toBe(true);
      expect(JSON.stringify(claimed)).not.toMatch(
        /awk_|PRIVATE KEY|accessToken/,
      );
      expect((await run()).resumed).toBe(true);
      expect(
        (await db.agent.findUniqueOrThrow({ where: { id: agent.id } }))
          .ownerUserId,
      ).toBe(user.id);
      expect(
        await db.apiKey.count({
          where: { agentId: agent.id, revokedAt: null },
        }),
      ).toBe(0);
      await db.apiKey.update({
        where: { id: key.id },
        data: { revokedAt: null },
      });
      await db.agentInstallation.update({
        where: { id: claimed.installationId },
        data: { revokedAt: new Date() },
      });
      await post('/v2/access/legacy-device', legacyToken, input).expect(409);
      expect(
        await db.agentAccessEvent.count({
          where: { agentId: agent.id, action: 'device.legacy_migrated' },
        }),
      ).toBe(1);
    } finally {
      if (directory.startsWith(resolve(tmpdir(), 'agentwork-legacy-claim-')))
        await rm(directory, { recursive: true, force: true });
    }
  }, 60000);
  it('delivers project events exactly once to member inboxes, retries rolled-back failures, and protects event cursors', async () => {
    const owner = await identity();
    const member = await identity();
    const stranger = await identity();
    const project = (
      await post('/v2/projects', owner.accessToken, projectInput()).expect(201)
    ).body;
    const base = `/v2/projects/${project.id}`;
    await post(`${base}/join`, member.accessToken, {}).expect(201);
    const task = (
      await post(`${base}/tasks`, owner.accessToken, {
        title: 'Event task',
        description: 'Goal',
        acceptanceCriteria: 'Verified',
      }).expect(201)
    ).body;
    await post(`${base}/tasks/${task.id}/commands`, owner.accessToken, {
      action: 'publish',
      expectedVersion: 1,
    }).expect(201);
    const read = (path: string, token: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`);
    const bootstrap = await read(
      `${base}/events?afterVersion=0`,
      owner.accessToken,
    ).expect(200);
    expect(bootstrap.body.snapshotRequired).toBe(true);
    projectEventsV2Schema.parse(bootstrap.body);
    const first = await read(
      `${base}/events?afterVersion=1&limit=2`,
      owner.accessToken,
    ).expect(200);
    expect(
      first.body.events.map((e: { version: number }) => e.version),
    ).toEqual([2, 3]);
    expect(first.body.hasMore).toBe(true);
    const second = await read(
      `${base}/events?afterVersion=3`,
      owner.accessToken,
    ).expect(200);
    expect(
      second.body.events.map((e: { version: number }) => e.version),
    ).toEqual([4, 5]);
    await read(`${base}/events?afterVersion=1`, stranger.accessToken).expect(
      403,
    );
    expect(await db.projectNotification.count()).toBe(0);
    const engines = [new ProjectEventEngine(db), new ProjectEventEngine(db)];
    await Promise.all(engines.map((engine) => engine.runBatch(10)));
    expect(await db.projectNotification.count()).toBe(7);
    const inbox = await read('/v2/inbox?limit=1', owner.accessToken).expect(
      200,
    );
    expect(inbox.body.unread).toBe(4);
    inboxV2Schema.parse(inbox.body);
    expect(inbox.body.items).toHaveLength(1);
    const notificationId = inbox.body.items[0].id;
    expect(
      (
        await post('/v2/inbox/ack', member.accessToken, {
          ids: [notificationId],
        }).expect(201)
      ).body.acknowledged,
    ).toBe(0);
    expect(
      (
        await post('/v2/inbox/ack', owner.accessToken, {
          ids: [notificationId],
        }).expect(201)
      ).body.acknowledged,
    ).toBe(1);
    expect(
      (
        await post('/v2/inbox/ack', owner.accessToken, {
          ids: [notificationId],
        }).expect(201)
      ).body.acknowledged,
    ).toBe(0);
    await db.projectEvent.update({
      where: { id: first.body.events[0].id },
      data: { deliveryStatus: 'PENDING', deliveredAt: null },
    });
    await engines[0]!.runBatch();
    expect(await db.projectNotification.count()).toBe(7);
    expect(
      (
        await db.projectNotification.findUniqueOrThrow({
          where: { id: notificationId },
        })
      ).readAt,
    ).not.toBeNull();
    await post(`${base}/tasks`, owner.accessToken, {
      title: 'Delivery failure',
      description: 'Goal',
      acceptanceCriteria: 'Retry',
    }).expect(201);
    const event = await db.projectEvent.findFirstOrThrow({
      where: { projectId: project.id, version: 6 },
    });
    class FailingEngine extends ProjectEventEngine {
      protected async deliver(
        tx: Prisma.TransactionClient,
        job: ProjectEventJob,
      ) {
        await super.deliver(tx, job);
        throw new Error('Simulated failure after inbox insert');
      }
    }
    let now = new Date();
    const failing = new FailingEngine(db, () => now);
    for (let attempt = 0; attempt < 6; attempt++) {
      await failing.runBatch(1);
      now = new Date(now.getTime() + 1000000);
    }
    expect(
      (await db.projectEvent.findUniqueOrThrow({ where: { id: event.id } }))
        .deliveryStatus,
    ).toBe('FAILED');
    expect(
      await db.projectNotification.count({ where: { eventId: event.id } }),
    ).toBe(0);
    await post(`${base}/events/${event.id}/retry`, member.accessToken, {
      reason: 'Member cannot retry delivery',
    }).expect(403);
    const failures = await read(
      `${base}/event-deliveries`,
      owner.accessToken,
    ).expect(200);
    v2Operations.projectEventDeliveries!.response.parse(failures.body);
    expect(failures.body.items[0].id).toBe(event.id);
    await read(`${base}/event-deliveries`, member.accessToken).expect(403);
    const failedTask = await db.workItem.findFirstOrThrow({
      where: { projectId: project.id, title: 'Delivery failure' },
    });
    await post(`${base}/tasks/${task.id}/commands`, owner.accessToken, {
      action: 'cancel',
      expectedVersion: 2,
      reason: 'End example work',
    }).expect(201);
    await post(`${base}/tasks/${failedTask.id}/commands`, owner.accessToken, {
      action: 'cancel',
      expectedVersion: 1,
      reason: 'End example work',
    }).expect(201);
    await post(`${base}/commands`, owner.accessToken, {
      action: 'archive',
      expectedVersion: (
        await db.project.findUniqueOrThrow({ where: { id: project.id } })
      ).version,
      reason: 'Archive completed scope',
    }).expect(201);
    await post(`${base}/events/${event.id}/retry`, owner.accessToken, {
      reason: 'Dependency recovered',
    }).expect(201);
    await engines[0]!.runBatch();
    expect(
      (await db.projectEvent.findUniqueOrThrow({ where: { id: event.id } }))
        .deliveryStatus,
    ).toBe('DELIVERED');
    expect(
      await db.projectNotification.count({ where: { eventId: event.id } }),
    ).toBe(2);
    await post(`${base}/commands`, owner.accessToken, {
      action: 'restore',
      expectedVersion: (
        await db.project.findUniqueOrThrow({ where: { id: project.id } })
      ).version,
      reason: 'Restore for handoff',
    }).expect(201);
    const current = await db.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    await post(`${base}/commands`, member.accessToken, {
      action: 'leave',
      expectedVersion: current.version,
      reason: 'Handoff complete',
    }).expect(201);
    expect(
      (await read('/v2/inbox', member.accessToken).expect(200)).body.items,
    ).toEqual([]);
    await db.project.update({
      where: { id: project.id },
      data: { eventBaselineVersion: 8 },
    });
    expect(
      (
        await read(`${base}/events?afterVersion=3`, owner.accessToken).expect(
          200,
        )
      ).body.snapshotRequired,
    ).toBe(true);
  });
  it('enrolls only authorized devices and recovers the same Agent while revoking old devices and stale recovery challenges', async () => {
    const owner = await identity();
    const other = await identity();
    const candidate = generateKeyPairSync('ed25519');
    const publicKey = candidate.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const challenge = await access.challenge(
      { name: 'Another device', slug: `device-${randomUUID()}`, publicKey },
      randomUUID(),
    );
    const signature = sign(
      null,
      Buffer.from(challenge.message),
      candidate.privateKey,
    ).toString('base64');
    await request(app.getHttpServer())
      .post('/v2/access/connect')
      .send({ challengeId: challenge.challengeId, signature, register: false })
      .expect(401);
    const enrolled = (
      await post('/v2/access/devices', owner.accessToken, {
        publicKey,
        label: 'Laptop',
      }).expect(201)
    ).body;
    const connected = (
      await request(app.getHttpServer())
        .post('/v2/access/connect')
        .send({
          challengeId: challenge.challengeId,
          signature,
          register: false,
        })
        .expect(201)
    ).body;
    expect(connected.agent.id).toBe(owner.agent.id);
    await post('/v2/access/devices', other.accessToken, {
      publicKey,
      label: 'Cannot steal',
    }).expect(409);
    await post(
      `/v2/access/devices/${enrolled.id}/revoke`,
      other.accessToken,
      {},
    ).expect(400);
    await db.agentSession.updateMany({
      where: { installationId: enrolled.id },
      data: { scopes: ['projects:read', 'projects:write'] },
    });
    await request(app.getHttpServer())
      .get('/v2/access/devices')
      .set('Authorization', `Bearer ${connected.accessToken}`)
      .expect(403);
    const backup = generateKeyPairSync('ed25519');
    const recoveryKey = backup.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    await post('/v2/access/recovery', connected.accessToken, {
      publicKey: recoveryKey,
    }).expect(403);
    await db.agentSession.updateMany({
      where: { installationId: enrolled.id },
      data: { scopes: [] },
    });
    await request(app.getHttpServer())
      .get('/v2/access/me')
      .set('Authorization', `Bearer ${connected.accessToken}`)
      .expect(200);
    await post('/v2/access/disconnect', connected.accessToken, {}).expect(201);
    await post('/v2/access/recovery', owner.accessToken, {
      publicKey: recoveryKey,
    }).expect(201);
    await post('/v2/access/recovery', owner.accessToken, {
      publicKey: recoveryKey,
    }).expect(201);
    const device = generateKeyPairSync('ed25519');
    const newPublic = device.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const recovery = (
      await request(app.getHttpServer())
        .post('/v2/access/recovery/challenge')
        .send({ agentId: owner.agent.id, publicKey: newPublic })
        .expect(201)
    ).body;
    const payload = {
      challengeId: recovery.challengeId,
      recoverySignature: sign(
        null,
        Buffer.from(recovery.message),
        backup.privateKey,
      ).toString('base64'),
      deviceSignature: sign(
        null,
        Buffer.from(recovery.message),
        device.privateKey,
      ).toString('base64'),
    };
    await request(app.getHttpServer())
      .post('/v2/access/connect')
      .send({
        challengeId: recovery.challengeId,
        signature: payload.deviceSignature,
      })
      .expect(401);
    await request(app.getHttpServer())
      .post('/v2/access/recovery/complete')
      .send({
        ...payload,
        recoverySignature: sign(
          null,
          Buffer.from(recovery.message),
          candidate.privateKey,
        ).toString('base64'),
      })
      .expect(401);
    const recovered = await request(app.getHttpServer())
      .post('/v2/access/recovery/complete')
      .send(payload)
      .expect(201);
    expect(recovered.body.agent.id).toBe(owner.agent.id);
    expect(
      await db.agentInstallation.count({
        where: { agentId: owner.agent.id, revokedAt: null },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .post('/v2/access/recovery/complete')
      .send(payload)
      .expect(401);
    await request(app.getHttpServer())
      .get('/v2/access/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/v2/access/me')
      .set('Authorization', `Bearer ${connected.accessToken}`)
      .expect(401);
    const fresh = await access.challenge(
      {
        name: 'Restored',
        slug: `restored-${randomUUID()}`,
        publicKey: newPublic,
      },
      randomUUID(),
    );
    const active = await access.connect(
      fresh.challengeId,
      sign(null, Buffer.from(fresh.message), device.privateKey).toString(
        'base64',
      ),
      false,
    );
    const pending = (
      await request(app.getHttpServer())
        .post('/v2/access/recovery/challenge')
        .send({ agentId: owner.agent.id, publicKey: newPublic })
        .expect(201)
    ).body;
    const nextBackup = generateKeyPairSync('ed25519');
    const nextPublic = nextBackup.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    await post('/v2/access/recovery', active.accessToken, {
      publicKey: nextPublic,
    }).expect(409);
    await post('/v2/access/recovery', active.accessToken, {
      publicKey: nextPublic,
      replace: true,
    }).expect(201);
    await request(app.getHttpServer())
      .post('/v2/access/recovery/complete')
      .send({
        challengeId: pending.challengeId,
        recoverySignature: sign(
          null,
          Buffer.from(pending.message),
          backup.privateKey,
        ).toString('base64'),
        deviceSignature: sign(
          null,
          Buffer.from(pending.message),
          device.privateKey,
        ).toString('base64'),
      })
      .expect(401);
    expect(
      await db.agentAccessEvent.count({
        where: { agentId: owner.agent.id, action: 'recovery.completed' },
      }),
    ).toBe(1);
  });

  it('restores a CLI identity from an encrypted backup and enrolls another local profile without exporting secrets', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'agentwork-recovery-cli-'));
    const cli = resolve(__dirname, '../../../../packages/cli/src/cli.mjs');
    const run = async (home: string, args: string[]) =>
      JSON.parse(
        (
          await exec(
            process.execPath,
            [cli, ...args, '--url', process.env.AGENTWORK_ORIGIN!],
            {
              env: { ...process.env, AGENTWORK_HOME: resolve(root, home) },
              windowsHide: true,
            },
          )
        ).stdout,
      );
    try {
      const owner = await run('owner', [
        'connect',
        '--name',
        'Recovery CLI',
        '--slug',
        `recovery-cli-${randomUUID()}`,
      ]);
      const password = resolve(root, 'passphrase');
      const backup = resolve(root, 'backup.json');
      await writeFile(password, `synthetic-${randomUUID()}-${randomUUID()}`);
      await run('owner', [
        'recovery-create',
        '--file',
        backup,
        '--passphrase-file',
        password,
      ]);
      const restored = await run('restored', [
        'recover',
        '--file',
        backup,
        '--passphrase-file',
        password,
      ]);
      expect(restored.agent.id).toBe(owner.agent.id);
      expect(restored.recovered).toBe(true);
      expect(JSON.stringify(restored)).not.toMatch(/PRIVATE KEY|accessToken/);
      await expect(run('owner', ['whoami'])).rejects.toThrow();
      const requestFile = resolve(root, 'device-request.json');
      await run('second', [
        'device-key',
        '--label',
        'Second machine',
        '--file',
        requestFile,
      ]);
      await expect(run('second', ['connect'])).rejects.toThrow();
      const authorized = await run('restored', [
        'authorize-device',
        '--file',
        requestFile,
      ]);
      expect((await run('second', ['connect'])).agent.id).toBe(owner.agent.id);
      expect(
        (await run('restored', ['devices'])).some(
          (d: { id: string }) => d.id === authorized.id,
        ),
      ).toBe(true);
      await run('restored', ['revoke-device', '--device', authorized.id]);
      await expect(run('second', ['whoami'])).rejects.toThrow();
      expect(await db.agent.count({ where: { id: owner.agent.id } })).toBe(1);
    } finally {
      if (root.startsWith(resolve(tmpdir(), 'agentwork-recovery-cli-')))
        await rm(root, { recursive: true, force: true });
    }
  }, 90000);
  it('paginates filtered projects, tasks and works without leaking private rows or counting only visible tasks', async () => {
    const owner = await identity();
    const worker = await identity();
    const needle = `page-${randomUUID()}`;
    const projects = [];
    for (let n = 0; n < 4; n++)
      projects.push(
        (
          await post('/v2/projects', owner.accessToken, {
            ...projectInput(),
            name: `${needle}-${n}`,
          }).expect(201)
        ).body,
      );
    await db.project.update({
      where: { id: projects[3].id },
      data: { visibility: 'PRIVATE' },
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const result: Response = await request(app.getHttpServer())
        .get(
          `/v2/public/project-pages?q=${needle}&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        )
        .expect(200);
      expect(result.body.total).toBe(3);
      projectPageV2Schema.parse(result.body);
      expect(result.body.items).toHaveLength(1);
      seen.push(result.body.items[0].id);
      cursor = result.body.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(3);
    expect(seen).not.toContain(projects[3].id);
    await request(app.getHttpServer())
      .get(`/v2/public/project-pages?q=${needle}&cursor=${projects[3].id}`)
      .expect(400);
    const mine = await request(app.getHttpServer())
      .get(`/v2/projects/page?q=${needle}&relation=created`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(mine.body.total).toBe(4);
    const project = projects[0];
    const base = `/v2/projects/${project.id}`;
    await post(`${base}/join`, worker.accessToken, {}).expect(201);
    const roadmap = (
      await post(`${base}/roadmaps`, owner.accessToken, {
        title: 'Full roadmap',
        description: 'All pages',
        startAt: '2026-09-10T00:00:00Z',
        endAt: '2026-10-10T00:00:00Z',
      }).expect(201)
    ).body;
    const tasks = [];
    const submissions = [];
    for (let n = 0; n < 6; n++)
      tasks.push(
        (
          await post(`${base}/tasks`, owner.accessToken, {
            title: `Task ${n}`,
            description: 'Work',
            acceptanceCriteria: 'Evidence',
            roadmapId: roadmap.id,
          }).expect(201)
        ).body,
      );
    for (const task of tasks.slice(0, 2)) {
      const path = `${base}/tasks/${task.id}/commands`;
      await post(path, owner.accessToken, {
        action: 'publish',
        expectedVersion: 1,
      }).expect(201);
      await post(path, worker.accessToken, {
        action: 'claim',
        expectedVersion: 2,
      }).expect(201);
      await post(path, worker.accessToken, {
        action: 'submit',
        expectedVersion: 3,
        reason: 'Done',
        evidenceUrl: 'https://example.com/evidence',
      }).expect(201);
      const accepted = await post(path, owner.accessToken, {
        action: 'accept',
        expectedVersion: 4,
        reason: 'Verified',
      }).expect(201);
      submissions.push(accepted.body.submissions[0]);
    }
    await post(`${base}/tasks/${tasks[2].id}/commands`, owner.accessToken, {
      action: 'cancel',
      expectedVersion: 1,
      reason: 'Out of scope',
    }).expect(201);
    const taskIds: string[] = [];
    let taskCursor: string | null = null;
    do {
      const page: Response = await request(app.getHttpServer())
        .get(
          `/v2/public/projects/${project.slug}?limit=2${taskCursor ? `&taskCursor=${taskCursor}` : ''}`,
        )
        .expect(200);
      expect(page.body.workItemsPage.total).toBe(6);
      projectDetailV2Schema.parse(page.body);
      expect(() =>
        projectDetailV2Schema.parse({
          ...page.body,
          gitUrl: 'git@private.example:internal/repo.git',
        }),
      ).toThrow();
      expect(page.body.roadmaps[0].taskCount).toBe(5);
      expect(page.body.roadmaps[0].completedTaskCount).toBe(2);
      taskIds.push(
        ...page.body.workItems.map((task: { id: string }) => task.id),
      );
      taskCursor = page.body.workItemsPage.nextCursor;
    } while (taskCursor);
    expect(new Set(taskIds).size).toBe(6);
    await request(app.getHttpServer())
      .get(`/v2/public/projects/${projects[1].slug}?taskCursor=${tasks[0].id}`)
      .expect(400);
    for (let n = 0; n < 2; n++)
      await post(`${base}/artifacts`, owner.accessToken, {
        submissionId: submissions[n].id,
        title: `Artifact ${n}`,
        description: 'Verified work',
        categories: [n ? 'DEVELOPMENT' : 'DESIGN'],
      }).expect(201);
    const artifactPage = await request(app.getHttpServer())
      .get(`/v2/public/artifacts/page?agentId=${worker.agent.id}&limit=1`)
      .expect(200);
    expect(artifactPage.body.total).toBe(2);
    artifactPageV2Schema.parse(artifactPage.body);
    expect(artifactPage.body.nextCursor).toBeTruthy();
    const next = await request(app.getHttpServer())
      .get(
        `/v2/public/artifacts/page?agentId=${worker.agent.id}&limit=1&cursor=${artifactPage.body.nextCursor}`,
      )
      .expect(200);
    expect(next.body.items[0].id).not.toBe(artifactPage.body.items[0].id);
    expect(next.body.nextCursor).toBe(null);
    const filtered = await request(app.getHttpServer())
      .get(
        `/v2/public/artifacts/page?agentId=${worker.agent.id}&category=DESIGN`,
      )
      .expect(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0].categories).toEqual(['DESIGN']);
  });
  it('returns consistent snapshot versions while tasks change and exposes only public project versions', async () => {
    const owner = await identity();
    const project = (
      await post('/v2/projects', owner.accessToken, projectInput()).expect(201)
    ).body;
    const base = `/v2/projects/${project.id}`;
    const task = (
      await post(`${base}/tasks`, owner.accessToken, {
        title: 'Revision 1',
        description: 'Changing work',
        acceptanceCriteria: 'Consistent snapshots',
      }).expect(201)
    ).body;
    await Promise.all([
      (async () => {
        for (let n = 1; n <= 10; n++)
          await post(`${base}/tasks/${task.id}/edit`, owner.accessToken, {
            expectedVersion: n,
            reason: 'Concurrent update',
            patch: { title: `Revision ${n + 1}` },
          }).expect(201);
      })(),
      (async () => {
        for (let n = 0; n < 12; n++) {
          const response = await request(app.getHttpServer())
            .get(`${base}/context`)
            .set('Authorization', `Bearer ${owner.accessToken}`)
            .expect(200);
          expect(response.body.snapshotVersion).toBe(
            response.body.project.workItems[0].version + 2,
          );
          projectContextV2Schema.parse(response.body);
        }
      })(),
    ]);
    const version = await request(app.getHttpServer())
      .get(`/v2/public/projects/${project.slug}/version`)
      .expect(200);
    expect(version.body.version).toBe(13);
    expect(version.headers['cache-control']).toBe('no-store');
    await db.project.update({
      where: { id: project.id },
      data: { visibility: 'PRIVATE' },
    });
    await request(app.getHttpServer())
      .get(`/v2/public/projects/${project.slug}/version`)
      .expect(404);
  });
  it('rejects dependency cycles under concurrent edits and enforces prerequisites and children', async () => {
    const owner = await identity();
    const project = (
      await post('/v2/projects', owner.accessToken, {
        ...projectInput(),
        reviewPolicy: 'SELF_REVIEW',
      }).expect(201)
    ).body;
    const base = `/v2/projects/${project.id}`;
    const createTask = async (title: string, extra = {}) =>
      (
        await post(`${base}/tasks`, owner.accessToken, {
          title,
          description: 'Task goal',
          acceptanceCriteria: 'Verified result',
          ...extra,
        }).expect(201)
      ).body;
    const a = await createTask('A');
    const b = await createTask('B');
    const races = await Promise.all([
      post(`${base}/tasks/${a.id}/edit`, owner.accessToken, {
        expectedVersion: 1,
        reason: 'Dependency A',
        patch: { dependsOnIds: [b.id] },
      }),
      post(`${base}/tasks/${b.id}/edit`, owner.accessToken, {
        expectedVersion: 1,
        reason: 'Dependency B',
        patch: { dependsOnIds: [a.id] },
      }),
    ]);
    expect(races.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db.workDependency.count({
        where: { workItemId: { in: [a.id, b.id] } },
      }),
    ).toBe(1);
    const first = await createTask('Prerequisite');
    const next = await createTask('Dependent', { dependsOnIds: [first.id] });
    await post(`${base}/tasks/${next.id}/commands`, owner.accessToken, {
      action: 'publish',
      expectedVersion: 1,
    }).expect(201);
    await post(`${base}/tasks/${next.id}/commands`, owner.accessToken, {
      action: 'claim',
      expectedVersion: 2,
    }).expect(409);
    const runFirst = `${base}/tasks/${first.id}/commands`;
    await post(runFirst, owner.accessToken, {
      action: 'publish',
      expectedVersion: 1,
    }).expect(201);
    await post(runFirst, owner.accessToken, {
      action: 'claim',
      expectedVersion: 2,
    }).expect(201);
    await post(runFirst, owner.accessToken, {
      action: 'submit',
      expectedVersion: 3,
      reason: 'Done',
      evidenceUrl: 'https://example.com/proof',
    }).expect(201);
    await post(runFirst, owner.accessToken, {
      action: 'accept',
      expectedVersion: 4,
      reason: 'Explicit self review',
    }).expect(201);
    await post(`${base}/tasks/${next.id}/commands`, owner.accessToken, {
      action: 'claim',
      expectedVersion: 2,
    }).expect(201);
    const parent = await createTask('Parent');
    await post(`${base}/tasks`, owner.accessToken, {
      title: 'Impossible child',
      description: 'Goal',
      acceptanceCriteria: 'Result',
      parentId: parent.id,
      dependsOnIds: [parent.id],
    }).expect(409);
    const child = await createTask('Child', { parentId: parent.id });
    const parentPath = `${base}/tasks/${parent.id}/commands`;
    await post(parentPath, owner.accessToken, {
      action: 'publish',
      expectedVersion: 1,
    }).expect(201);
    await post(parentPath, owner.accessToken, {
      action: 'claim',
      expectedVersion: 2,
    }).expect(201);
    await post(parentPath, owner.accessToken, {
      action: 'submit',
      expectedVersion: 3,
      reason: 'Too early',
      evidenceUrl: 'https://example.com/proof',
    }).expect(409);
    await post(`${base}/tasks/${child.id}/commands`, owner.accessToken, {
      action: 'cancel',
      expectedVersion: 1,
      reason: 'Removed scope',
    }).expect(201);
    await post(parentPath, owner.accessToken, {
      action: 'submit',
      expectedVersion: 3,
      reason: 'Scope done',
      evidenceUrl: 'https://example.com/proof',
    }).expect(201);
    const other = (
      await post('/v2/projects', owner.accessToken, projectInput()).expect(201)
    ).body;
    await post(`/v2/projects/${other.id}/tasks`, owner.accessToken, {
      title: 'Cross project',
      description: 'Goal',
      acceptanceCriteria: 'Result',
      dependsOnIds: [first.id],
    }).expect(400);
  });

  it('versions scope corrections and supersedes pending reviews instead of approving old requirements', async () => {
    const owner = await identity();
    const worker = await identity();
    const project = (
      await post('/v2/projects', owner.accessToken, projectInput()).expect(201)
    ).body;
    const base = `/v2/projects/${project.id}`;
    await post(`${base}/join`, worker.accessToken, {}).expect(201);
    const work = (
      await post(`${base}/tasks`, worker.accessToken, {
        title: 'Layout',
        description: 'Initial layout',
        acceptanceCriteria: 'Desktop works',
        category: 'DESIGN',
        priority: 'HIGH',
      }).expect(201)
    ).body;
    const edit = `${base}/tasks/${work.id}/edit`;
    const cmd = `${base}/tasks/${work.id}/commands`;
    const initial = await post(edit, worker.accessToken, {
      expectedVersion: 1,
      reason: 'Clarify title',
      patch: { title: 'Responsive layout' },
    }).expect(201);
    expect(initial.body.category).toBe('DESIGN');
    expect(initial.body.priority).toBe('HIGH');
    await post(cmd, owner.accessToken, {
      action: 'publish',
      expectedVersion: 2,
    }).expect(201);
    await post(cmd, worker.accessToken, {
      action: 'claim',
      expectedVersion: 3,
    }).expect(201);
    await post(cmd, worker.accessToken, {
      action: 'submit',
      expectedVersion: 4,
      reason: 'Desktop ready',
      evidenceUrl: 'https://example.com/layout',
    }).expect(201);
    await post(edit, worker.accessToken, {
      expectedVersion: 5,
      reason: 'Change criteria',
      patch: { acceptanceCriteria: 'Looks good' },
    }).expect(403);
    const changed = await post(edit, owner.accessToken, {
      expectedVersion: 5,
      reason: 'Human requested mobile support',
      patch: { acceptanceCriteria: 'Desktop and 390px mobile work' },
    }).expect(201);
    expect(changed.body.status).toBe('IN_PROGRESS');
    expect(changed.body.submissions[0].reviewDecision).toBe('SUPERSEDED');
    await post(cmd, owner.accessToken, {
      action: 'accept',
      expectedVersion: 5,
      reason: 'Stale review',
    }).expect(409);
    await post(cmd, owner.accessToken, {
      action: 'accept',
      expectedVersion: 6,
      reason: 'No new submission',
    }).expect(409);
    await post(cmd, worker.accessToken, {
      action: 'submit',
      expectedVersion: 6,
      reason: 'Mobile added',
      evidenceUrl: 'https://example.com/layout-v2',
    }).expect(201);
    await post(cmd, owner.accessToken, {
      action: 'accept',
      expectedVersion: 7,
      reason: 'Verified both viewports',
    }).expect(201);
    await post(edit, owner.accessToken, {
      expectedVersion: 8,
      reason: 'Rewrite history',
      patch: { title: 'Different task' },
    }).expect(409);
    expect(
      await db.projectEvent.count({
        where: { resourceId: work.id, type: 'work.edited' },
      }),
    ).toBe(2);
  });

  it('edits roadmaps safely and transfers ownership without changing project authorship', async () => {
    const founder = await identity();
    const successor = await identity();
    const project = (
      await post('/v2/projects', founder.accessToken, projectInput()).expect(
        201,
      )
    ).body;
    const base = `/v2/projects/${project.id}`;
    const version = async () =>
      (await db.project.findUniqueOrThrow({ where: { id: project.id } }))
        .version;
    await post(`${base}/join`, successor.accessToken, {}).expect(201);
    const roadmap = (
      await post(`${base}/roadmaps`, founder.accessToken, {
        title: 'Phase 1',
        description: 'Initial plan',
        startAt: '2026-09-10T00:00:00Z',
        endAt: '2026-09-20T00:00:00Z',
      }).expect(201)
    ).body;
    await post(`${base}/roadmaps/${roadmap.id}/edit`, founder.accessToken, {
      expectedVersion: 1,
      reason: 'Wrong dates',
      patch: { startAt: '2026-10-01T00:00:00Z' },
    }).expect(400);
    await post(`${base}/roadmaps/${roadmap.id}/edit`, founder.accessToken, {
      expectedVersion: 1,
      reason: 'Extend deadline',
      patch: { endAt: '2026-10-01T00:00:00Z' },
    }).expect(201);
    const task = (
      await post(`${base}/tasks`, successor.accessToken, {
        title: 'Ownership task',
        description: 'Goal',
        acceptanceCriteria: 'Done',
      }).expect(201)
    ).body;
    await post(`${base}/tasks/${task.id}/commands`, successor.accessToken, {
      action: 'publish',
      expectedVersion: 1,
    }).expect(201);
    await post(`${base}/tasks/${task.id}/commands`, successor.accessToken, {
      action: 'claim',
      expectedVersion: 2,
    }).expect(201);
    await post(`${base}/commands`, successor.accessToken, {
      action: 'leave',
      expectedVersion: await version(),
      reason: 'Still busy',
    }).expect(409);
    const transferred = await post(`${base}/commands`, founder.accessToken, {
      action: 'transfer',
      agentId: successor.agent.id,
      expectedVersion: await version(),
      reason: 'Handoff ownership',
    }).expect(201);
    expect(transferred.body.ownerAgentId).toBe(successor.agent.id);
    expect(transferred.body.creatorAgentId).toBe(founder.agent.id);
    await post(`${base}/commands`, founder.accessToken, {
      action: 'set_role',
      agentId: successor.agent.id,
      role: 'MEMBER',
      expectedVersion: await version(),
      reason: 'Cannot demote owner',
    }).expect(403);
    await post(`${base}/commands`, successor.accessToken, {
      action: 'archive',
      expectedVersion: await version(),
      reason: 'Work still active',
    }).expect(409);
    await post(`${base}/tasks/${task.id}/commands`, founder.accessToken, {
      action: 'cancel',
      expectedVersion: 3,
      reason: 'Scope cancelled',
    }).expect(201);
    await post(`${base}/commands`, successor.accessToken, {
      action: 'archive',
      expectedVersion: await version(),
      reason: 'Finished',
    }).expect(201);
    await post(`${base}/tasks`, founder.accessToken, {
      title: 'Archived write',
      description: 'No',
      acceptanceCriteria: 'No',
    }).expect(409);
    await post(`${base}/commands`, successor.accessToken, {
      action: 'restore',
      expectedVersion: await version(),
      reason: 'Next phase',
    }).expect(201);
    await post(`${base}/commands`, founder.accessToken, {
      action: 'leave',
      expectedVersion: await version(),
      reason: 'Handoff complete',
    }).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/v2/public/projects?agentId=${founder.agent.id}`)
      .expect(200);
    expect(mine.body.some((p: { id: string }) => p.id === project.id)).toBe(
      true,
    );
    await db.project.update({
      where: { id: project.id },
      data: { visibility: 'PRIVATE' },
    });
    const hidden = await request(app.getHttpServer())
      .get('/v2/projects/page')
      .set('Authorization', `Bearer ${founder.accessToken}`)
      .expect(200);
    expect(
      hidden.body.items.some((p: { id: string }) => p.id === project.id),
    ).toBe(false);
  });
  it('tracks a defect through repair, independent verification, reopening and evidence-based works', async () => {
    const owner = await identity();
    const fixer = await identity();
    const project = (
      await post('/v2/projects', owner.accessToken, projectInput()).expect(201)
    ).body;
    const base = `/v2/projects/${project.id}`;
    await post(`${base}/join`, fixer.accessToken, {}).expect(201);
    const defect = (
      await post(`${base}/defects`, fixer.accessToken, {
        title: 'Mobile button obscured',
        reproduction: 'Open at 390px width',
        expectedBehavior: 'Button remains visible',
        environment: 'Mobile browser',
        severity: 'HIGH',
      }).expect(201)
    ).body;
    const path = `${base}/defects/${defect.id}/commands`;
    await post(path, fixer.accessToken, {
      action: 'triage',
      expectedVersion: 1,
      reason: 'Confirmed',
    }).expect(403);
    await post(path, owner.accessToken, {
      action: 'triage',
      expectedVersion: 1,
      reason: 'Reproduced on phone',
    }).expect(201);
    const repairing = (
      await post(path, fixer.accessToken, {
        action: 'start_fix',
        expectedVersion: 2,
        reason: 'Repairing layout',
      }).expect(201)
    ).body;
    expect(repairing.fixTask.assigneeAgentId).toBe(fixer.agent.id);
    await post(path, fixer.accessToken, {
      action: 'request_verification',
      expectedVersion: 3,
      reason: 'Seems fixed',
    }).expect(409);
    const taskPath = `${base}/tasks/${repairing.fixTaskId}/commands`;
    const submission = (
      await post(taskPath, fixer.accessToken, {
        action: 'submit',
        expectedVersion: 1,
        reason: 'Mobile layout verified',
        evidenceUrl: 'https://example.com/mobile-design',
      }).expect(201)
    ).body.submissions[0];
    const artifact = {
      submissionId: submission.id,
      title: 'Mobile project layout',
      description: 'Accessible layout for small screens',
      categories: ['DEVELOPMENT', 'DESIGN'],
    };
    await post(`${base}/artifacts`, owner.accessToken, artifact).expect(400);
    await post(taskPath, owner.accessToken, {
      action: 'accept',
      expectedVersion: 2,
      reason: 'Tests and preview pass',
    }).expect(201);
    await post(path, fixer.accessToken, {
      action: 'request_verification',
      expectedVersion: 3,
      reason: 'Ready for verification',
    }).expect(201);
    await post(path, fixer.accessToken, {
      action: 'close',
      expectedVersion: 4,
      reason: 'Self verify',
    }).expect(403);
    await post(path, owner.accessToken, {
      action: 'close',
      expectedVersion: 4,
      reason: 'Verified at mobile viewport',
    }).expect(201);
    await post(`${base}/artifacts`, fixer.accessToken, artifact).expect(403);
    await post(`${base}/artifacts`, owner.accessToken, artifact).expect(201);
    const works = await request(app.getHttpServer())
      .get(`/v2/public/artifacts?agentId=${fixer.agent.id}`)
      .expect(200);
    expect(works.body).toHaveLength(1);
    expect(works.body[0].categories).toEqual(['DEVELOPMENT', 'DESIGN']);
    expect(
      works.body[0].contributions
        .map((c: { agent: { id: string } }) => c.agent.id)
        .sort(),
    ).toEqual([owner.agent.id, fixer.agent.id].sort());
    expect(JSON.stringify(works.body)).not.toContain('private.git');
    await post(path, owner.accessToken, {
      action: 'reopen',
      expectedVersion: 5,
      reason: 'Regression in another viewport',
    }).expect(201);
    const secondFix = (
      await post(path, fixer.accessToken, {
        action: 'start_fix',
        expectedVersion: 6,
        reason: 'Addressing regression',
      }).expect(201)
    ).body;
    expect(secondFix.fixTaskId).not.toBe(repairing.fixTaskId);
    expect(
      await db.projectEvent.findFirst({
        where: { resourceId: defect.id, type: 'defect.reopen' },
      }),
    ).toBeTruthy();
    expect(
      (
        await db.workItem.findUniqueOrThrow({
          where: { id: repairing.fixTaskId },
        })
      ).status,
    ).toBe('DONE');
  });
  it('runs the actual local CLI and persists its signed identity without exposing keys', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'agentwork-cli-test-'));
    const cli = resolve(__dirname, '../../../../packages/cli/src/cli.mjs');
    const cliEnv: NodeJS.ProcessEnv = {
      ...process.env,
      AGENTWORK_HOME: directory,
    };
    const run = (...args: string[]) =>
      exec(
        process.execPath,
        [cli, ...args, '--url', process.env.AGENTWORK_ORIGIN!],
        {
          env: cliEnv,
          windowsHide: true,
        },
      );
    try {
      const first = await run(
        'connect',
        '--name',
        'CLI Agent',
        '--slug',
        `cli-${randomUUID()}`,
      );
      const connected = JSON.parse(first.stdout);
      const second = JSON.parse((await run('whoami')).stdout);
      expect(second.agent.id).toBe(connected.agent.id);
      expect(first.stdout).not.toMatch(/PRIVATE KEY|accessToken|aws_/);
      expect(JSON.parse((await run('projects')).stdout)).toEqual([]);
      const bare = resolve(directory, 'remote.git');
      await exec('git', ['init', '--bare', '--initial-branch=main', bare], {
        windowsHide: true,
      });
      Object.assign(cliEnv, {
        GIT_ALLOW_PROTOCOL: 'file',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.${pathToFileURL(bare).href}.insteadOf`,
        GIT_CONFIG_VALUE_0: 'https://github.com/agentwork-test/cli-project.git',
      });
      const projectFile = resolve(directory, 'project.json');
      await writeFile(
        projectFile,
        JSON.stringify({
          ...projectInput(),
          gitUrl: 'https://github.com/agentwork-test/cli-project.git',
        }),
      );
      const checkout = resolve(directory, 'workspace');
      const initialized = JSON.parse(
        (
          await run(
            'project-init',
            '--file',
            projectFile,
            '--directory',
            checkout,
          )
        ).stdout,
      );
      expect(initialized.stage).toBe('READY');
      expect(
        (
          await db.project.findUniqueOrThrow({
            where: { id: initialized.projectId },
          })
        ).creatorAgentId,
      ).toBe(connected.agent.id);
      expect(
        (
          await exec('git', ['--git-dir', bare, 'rev-parse', 'main'], {
            windowsHide: true,
          })
        ).stdout.trim(),
      ).toBe(initialized.commit);
      const fromBinding = await exec(process.execPath, [cli, 'context'], {
        cwd: checkout,
        env: { ...cliEnv, AGENTWORK_URL: undefined },
        windowsHide: true,
      });
      expect(JSON.parse(fromBinding.stdout).project.id).toBe(
        initialized.projectId,
      );
      const cloned = JSON.parse(
        (
          await run(
            'checkout',
            '--project',
            initialized.projectId,
            '--directory',
            resolve(directory, 'clone'),
          )
        ).stdout,
      );
      expect(cloned.projectId).toBe(initialized.projectId);
      const pulled = JSON.parse(
        (await run('sync-pull', '--directory', checkout)).stdout,
      );
      expect(pulled.tasks).toBe(0);
      const changeFile = resolve(directory, 'change.json');
      await writeFile(
        changeFile,
        JSON.stringify({
          kind: 'task.create',
          input: {
            title: 'Queued offline plan',
            description: 'Implement later',
            acceptanceCriteria: 'Reviewed result',
          },
        }),
      );
      const staged = JSON.parse(
        (await run('sync-stage', '--directory', checkout, '--file', changeFile))
          .stdout,
      );
      expect(staged.status).toBe('pending');
      expect(
        await db.workItem.count({
          where: { projectId: initialized.projectId },
        }),
      ).toBe(0);
      const pushed = JSON.parse(
        (await run('sync-push', '--directory', checkout)).stdout,
      );
      expect(pushed.applied).toHaveLength(1);
      expect(pushed.remaining).toBe(0);
      const secondPull = JSON.parse(
        (await run('sync-pull', '--directory', checkout)).stdout,
      );
      expect(secondPull.tasks).toBe(1);
      expect(
        (
          await db.workItem.findUniqueOrThrow({
            where: { id: pushed.applied[0].result.id },
          })
        ).status,
      ).toBe('DRAFT');
      expect(
        JSON.parse(
          (
            await run(
              'project-init',
              '--file',
              projectFile,
              '--directory',
              checkout,
            )
          ).stdout,
        ).resumed,
      ).toBe(true);
      await run('disconnect');
    } finally {
      // Only the unique temporary directory created by this test is removed.
      if (directory.startsWith(resolve(tmpdir(), 'agentwork-cli-test-')))
        await rm(directory, { recursive: true, force: true });
    }
  }, 60000);
  it('keeps the same identity across sessions, consumes challenges once and revokes installations', async () => {
    const usersBefore = await db.user.count();
    const agent = await identity();
    expect(await db.user.count()).toBe(usersBefore);
    await request(app.getHttpServer())
      .post('/v2/access/connect')
      .send({
        challengeId: agent.challenge.challengeId,
        signature: agent.signature,
      })
      .expect(401);
    const challenge = await access.challenge(agent.input, randomUUID());
    const session = await access.connect(
      challenge.challengeId,
      sign(
        null,
        Buffer.from(challenge.message),
        agent.keys.privateKey,
      ).toString('base64'),
    );
    expect(session.agent.id).toBe(agent.agent.id);
    await post('/v2/access/revoke', session.accessToken, {}).expect(201);
    await request(app.getHttpServer())
      .get('/v2/access/me')
      .set('Authorization', `Bearer ${agent.accessToken}`)
      .expect(401);
    const revoked = await access.challenge(agent.input, randomUUID());
    await expect(
      access.connect(
        revoked.challengeId,
        sign(
          null,
          Buffer.from(revoked.message),
          agent.keys.privateKey,
        ).toString('base64'),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects wrong signatures, cookies, missing credentials, invalid Git URLs and anonymous writes', async () => {
    const agent = await identity();
    const challenge = await access.challenge(agent.input, randomUUID());
    const other = generateKeyPairSync('ed25519');
    await request(app.getHttpServer())
      .post('/v2/access/connect')
      .send({
        challengeId: challenge.challengeId,
        signature: sign(
          null,
          Buffer.from(challenge.message),
          other.privateKey,
        ).toString('base64'),
      })
      .expect(401);
    await request(app.getHttpServer())
      .post('/v2/projects')
      .set('Cookie', 'aw_session=pretend-human')
      .send(projectInput())
      .expect(401);
    await request(app.getHttpServer())
      .post('/v2/projects')
      .send(projectInput())
      .expect(401);
    await post('/v2/projects', agent.accessToken, {
      ...projectInput(),
      gitUrl: 'https://secret@github.com/repo.git',
    }).expect(400);
    await request(app.getHttpServer())
      .post('/v2/projects')
      .set('Authorization', `Bearer ${agent.accessToken}`)
      .send(projectInput())
      .expect(400);
  });

  it('supports public read, member-only context, idempotent creation and a concurrent claim/review loop', async () => {
    const owner = await identity();
    const first = await identity();
    const second = await identity();
    const stranger = await identity();
    const input = projectInput();
    const key = idempotency();
    const created = await post(
      '/v2/projects',
      owner.accessToken,
      input,
      key,
    ).expect(201);
    const project = created.body;
    const again = await post(
      '/v2/projects',
      owner.accessToken,
      input,
      key,
    ).expect(201);
    expect(again.body.id).toBe(project.id);
    await post(
      '/v2/projects',
      owner.accessToken,
      { ...input, name: 'Changed' },
      key,
    ).expect(409);
    const publicPage = await request(app.getHttpServer())
      .get(`/v2/public/projects/${project.slug}`)
      .expect(200);
    expect(publicPage.body.gitUrl).toBeUndefined();
    expect(JSON.stringify(publicPage.body)).not.toContain('private.git');
    await request(app.getHttpServer())
      .get(`/v2/projects/${project.id}/context`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(403);
    for (const agent of [first, second])
      await post(
        `/v2/projects/${project.id}/join`,
        agent.accessToken,
        {},
      ).expect(201);
    await post(`/v2/projects/${project.id}/roadmaps`, first.accessToken, {
      title: 'Phase',
      description: 'Goal',
      startAt: '2026-09-10T00:00:00Z',
      endAt: '2026-09-20T00:00:00Z',
    }).expect(403);
    const roadmap = await post(
      `/v2/projects/${project.id}/roadmaps`,
      owner.accessToken,
      {
        title: 'Phase',
        description: 'Goal',
        startAt: '2026-09-10T00:00:00Z',
        endAt: '2026-09-20T00:00:00Z',
      },
    ).expect(201);
    const task = (
      await post(`/v2/projects/${project.id}/tasks`, owner.accessToken, {
        title: 'Build component',
        description: 'Implement component',
        acceptanceCriteria: 'Works on mobile',
        roadmapId: roadmap.body.id,
      }).expect(201)
    ).body;
    await post(`/v2/projects/${project.id}/tasks`, stranger.accessToken, {
      title: 'Attack',
      description: 'No',
      acceptanceCriteria: 'No',
    }).expect(403);
    const path = `/v2/projects/${project.id}/tasks/${task.id}/commands`;
    await post(path, owner.accessToken, {
      action: 'publish',
      expectedVersion: 1,
    }).expect(201);
    const responses = await Promise.all([
      post(path, first.accessToken, { action: 'claim', expectedVersion: 2 }),
      post(path, second.accessToken, { action: 'claim', expectedVersion: 2 }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = responses[0]!.status === 201 ? first : second;
    await post(path, winner.accessToken, {
      action: 'submit',
      expectedVersion: 3,
      reason: 'Implemented and tested',
      evidenceUrl: 'https://github.com/example/repo/pull/1',
    }).expect(201);
    await post(path, winner.accessToken, {
      action: 'accept',
      expectedVersion: 4,
      reason: 'Looks good',
    }).expect(403);
    const reviewed = await post(path, owner.accessToken, {
      action: 'accept',
      expectedVersion: 4,
      reason: 'Verified against acceptance criteria',
    }).expect(201);
    expect(reviewed.body.status).toBe('DONE');
    expect(reviewed.body.submissions[0].reviewerAgentId).toBe(owner.agent.id);
    expect(await db.ledgerTransaction.count()).toBe(0);
    expect(
      await db.projectEvent.count({ where: { projectId: project.id } }),
    ).toBe(9);
    const list = await request(app.getHttpServer())
      .get(`/v2/public/projects?agentId=${winner.agent.id}`)
      .expect(200);
    expect(list.body.some((p: { id: string }) => p.id === project.id)).toBe(
      true,
    );
  });

  it('blocks owner self-review by default and cross-project roadmap references', async () => {
    const owner = await identity();
    const a = (
      await post('/v2/projects', owner.accessToken, projectInput()).expect(201)
    ).body;
    const b = (
      await post('/v2/projects', owner.accessToken, projectInput()).expect(201)
    ).body;
    const roadmap = (
      await post(`/v2/projects/${a.id}/roadmaps`, owner.accessToken, {
        title: 'Phase',
        description: 'Goal',
        startAt: '2026-09-10T00:00:00Z',
        endAt: '2026-09-20T00:00:00Z',
      }).expect(201)
    ).body;
    await post(`/v2/projects/${b.id}/tasks`, owner.accessToken, {
      title: 'Task',
      description: 'Description',
      acceptanceCriteria: 'Tests pass',
      roadmapId: roadmap.id,
    }).expect(400);
    const task = (
      await post(`/v2/projects/${a.id}/tasks`, owner.accessToken, {
        title: 'Task',
        description: 'Description',
        acceptanceCriteria: 'Tests pass',
      }).expect(201)
    ).body;
    const path = `/v2/projects/${a.id}/tasks/${task.id}/commands`;
    await post(path, owner.accessToken, {
      action: 'publish',
      expectedVersion: 1,
    }).expect(201);
    await post(path, owner.accessToken, {
      action: 'claim',
      expectedVersion: 2,
    }).expect(201);
    await post(path, owner.accessToken, {
      action: 'submit',
      expectedVersion: 3,
      reason: 'Done',
      evidenceUrl: 'https://example.com/result',
    }).expect(201);
    await post(path, owner.accessToken, {
      action: 'accept',
      expectedVersion: 4,
      reason: 'Self',
    }).expect(403);
    expect(
      (await db.workItem.findUniqueOrThrow({ where: { id: task.id } })).version,
    ).toBe(4);
  });
});
