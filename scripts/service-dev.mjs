import { join } from 'node:path';
import { loadWorkspaceEnv, workspaceRoot } from './env.mjs';
import { runNode } from './run-node.mjs';

try {
  loadWorkspaceEnv();
  const service = process.argv[2];
  const required = {
    api: ['DATABASE_URL', 'AUTH_JWT_SECRET', 'CHALLENGE_SECRET'],
    worker: ['DATABASE_URL', 'WEBHOOK_SIGNING_SECRET'],
    web: [],
  };
  if (!Object.hasOwn(required, service))
    throw new Error('Choose api, web or worker');
  const missing = required[service].filter((name) => !process.env[name]);
  if (missing.length)
    throw new Error(
      `Missing ${missing.join(', ')}. Copy .env.example to .env or provide environment variables.`,
    );
  const ports = {
    api: Number(process.env.API_PORT ?? 3001),
    web: Number(process.env.WEB_PORT ?? 3000),
    worker: Number(process.env.WORKER_HEALTH_PORT ?? 3002),
  };
  if (
    Object.values(ports).some(
      (port) => !Number.isInteger(port) || port < 1 || port > 65535,
    ) ||
    new Set(Object.values(ports)).size !== 3
  )
    throw new Error('API, Web and Worker ports must be valid and distinct');
  if (process.argv.includes('--check'))
    console.log(
      JSON.stringify({ service, port: ports[service], configured: true }),
    );
  else {
    const cwd = join(workspaceRoot, 'apps', service);
    const commands = {
      api: [
        join(cwd, 'node_modules/@nestjs/cli/bin/nest.js'),
        'start',
        '--watch',
      ],
      web: [
        join(cwd, 'node_modules/next/dist/bin/next'),
        'dev',
        '-p',
        String(ports.web),
        '--hostname',
        '127.0.0.1',
      ],
      worker: [
        join(cwd, 'node_modules/tsx/dist/cli.mjs'),
        'watch',
        'src/main.ts',
      ],
    };
    runNode(commands[service], {
      cwd,
      env: {
        ...process.env,
        ...(service === 'api' ? { PORT: String(ports.api) } : {}),
        API_BASE_URL:
          process.env.API_BASE_URL ?? `http://127.0.0.1:${ports.api}`,
      },
    });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
