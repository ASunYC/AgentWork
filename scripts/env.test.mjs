import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const service = fileURLToPath(new URL('./service-dev.mjs', import.meta.url));
const runner = fileURLToPath(new URL('./env-run.mjs', import.meta.url));

test('local entrypoints load an explicit environment file, preserve overrides, and never print secrets', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agentwork-env-test-'));
  t.after(async () => {
    assert.ok(
      resolve(directory).startsWith(resolve(tmpdir(), 'agentwork-env-test-')),
    );
    await rm(directory, { recursive: true, force: true });
  });
  const file = join(directory, '.env');
  await writeFile(
    file,
    'DATABASE_URL=postgresql://test\nAUTH_JWT_SECRET="synthetic jwt secret"\nCHALLENGE_SECRET=synthetic-challenge\nWEBHOOK_SIGNING_SECRET=synthetic-webhook\nAPI_PORT=3451\nWEB_PORT=3450\nWORKER_HEALTH_PORT=3452\n',
  );
  const env = { ...process.env, AGENTWORK_ENV_FILE: file, API_PORT: '3461' };
  const result = execFileSync(process.execPath, [service, 'api', '--check'], {
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
  assert.equal(JSON.parse(result).port, 3461);
  assert.doesNotMatch(result, /synthetic|postgresql/);
  const probe = join(directory, 'probe.mjs');
  await writeFile(probe, 'process.stdout.write(process.env.API_PORT)');
  assert.equal(
    execFileSync(process.execPath, [runner, probe], {
      encoding: 'utf8',
      env,
      windowsHide: true,
    }),
    '3461',
  );
  assert.throws(() =>
    execFileSync(process.execPath, [service, 'api', '--check'], {
      encoding: 'utf8',
      env: { ...env, WEB_PORT: '3461' },
      stdio: 'pipe',
      windowsHide: true,
    }),
  );
  assert.throws(() =>
    execFileSync(process.execPath, [service, 'api', '--check'], {
      encoding: 'utf8',
      env: { ...env, AGENTWORK_ENV_FILE: join(directory, 'missing') },
      stdio: 'pipe',
      windowsHide: true,
    }),
  );
});
