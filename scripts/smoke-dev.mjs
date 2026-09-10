import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentWorkConnection } from '../packages/cli/src/client.mjs';
import { workspaceRoot } from './env.mjs';

const require = createRequire(
  new URL('../packages/database/package.json', import.meta.url),
);
const { PostgreSqlContainer } = require('@testcontainers/postgresql');
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'agentwork-startup-smoke-'));
const children = [];
let container;
const port = async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
};
const waitFor = async (check) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null))
      throw new Error('A local service exited before readiness');
    try {
      if (await check()) return;
    } catch {
      /* Wait for the owned service. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Local service readiness timed out');
};
try {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const apiPort = await port();
  let webPort = await port();
  while (webPort === apiPort) webPort = await port();
  let workerPort = await port();
  while ([apiPort, webPort].includes(workerPort)) workerPort = await port();
  const api = `http://127.0.0.1:${apiPort}`;
  const web = `http://127.0.0.1:${webPort}`;
  const config = {
    DATABASE_URL: container.getConnectionUri(),
    AUTH_JWT_SECRET: `smoke-${randomUUID()}`,
    CHALLENGE_SECRET: `smoke-${randomUUID()}`,
    WEBHOOK_SIGNING_SECRET: `smoke-${randomUUID()}`,
    AGENTWORK_ORIGIN: api,
    API_PORT: String(apiPort),
    WEB_PORT: String(webPort),
    WORKER_HEALTH_PORT: String(workerPort),
    LEGACY_WRITE_ENABLED: 'false',
    NODE_ENV: 'development',
  };
  const file = join(directory, '.env');
  await writeFile(
    file,
    Object.entries(config)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n'),
  );
  const env = {
    ...process.env,
    ...Object.fromEntries(Object.keys(config).map((name) => [name, undefined])),
    API_BASE_URL: undefined,
    AGENTWORK_ENV_FILE: file,
  };
  await run(
    process.execPath,
    [
      fileURLToPath(new URL('./env-run.mjs', import.meta.url)),
      'packages/database/dist/migrate.js',
    ],
    { cwd: workspaceRoot, env, windowsHide: true, timeout: 60000 },
  );
  for (const service of ['api', 'worker', 'web']) {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./service-dev.mjs', import.meta.url)), service],
      {
        cwd: workspaceRoot,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout.resume();
    child.stderr.resume();
    children.push(child);
  }
  await waitFor(async () => (await fetch(`${api}/health`)).ok);
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${workerPort}/ready`)).ok,
  );
  const client = new AgentWorkConnection(api, {
    home: join(directory, 'client'),
  });
  const identity = await client.connect({
    name: 'Startup Agent',
    slug: `startup-${randomUUID()}`,
  });
  const name = `Startup-project-${randomUUID()}`;
  const project = await client.call(
    '/v2/projects',
    {
      name,
      slug: `startup-project-${randomUUID()}`,
      description: 'Startup integration',
      categories: ['DEVELOPMENT'],
      gitUrl: 'https://example.com/source.git',
    },
    randomUUID(),
  );
  assert.equal(project.creatorAgentId, identity.agent.id);
  await waitFor(async () =>
    (await client.call('/v2/inbox')).items.some(
      (item) => item.event.projectId === project.id,
    ),
  );
  await waitFor(async () => (await fetch(`${web}/projects`)).ok);
  const html = await (await fetch(`${web}/projects`)).text();
  assert.ok(html.includes(name));
  assert.doesNotMatch(html, /href="\/login"/);
  assert.equal(
    (
      await fetch(`${api}/v2/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    401,
  );
  console.log(
    JSON.stringify({
      api: 'ready',
      worker: 'delivered',
      web: 'rendered-real-project',
      anonymousWrite: 'denied',
      environmentFile: 'loaded',
    }),
  );
} finally {
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (process.platform === 'win32')
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      else child.kill('SIGTERM');
    } catch {
      /* Owned process already stopped. */
    }
  }
  await container?.stop();
  assert.ok(
    resolve(directory).startsWith(
      resolve(tmpdir(), 'agentwork-startup-smoke-'),
    ),
  );
  await rm(directory, { recursive: true, force: true });
}
