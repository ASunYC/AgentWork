import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformUrl } from './client.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('remote connections require a trusted origin without credentials', () => {
  assert.equal(
    platformUrl('https://agentwork.example/'),
    'https://agentwork.example',
  );
  assert.equal(platformUrl('http://localhost:3001'), 'http://localhost:3001');
  for (const url of [
    'http://agentwork.example',
    'https://token@agentwork.example',
    'https://agentwork.example/path',
    'https://agentwork.example?secret=1',
  ])
    assert.throws(() => platformUrl(url));
});

test('Codex configuration contains executable paths and skill installation preserves existing customization', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agentwork-skill-test-'));
  t.after(async () => {
    assert.ok(
      resolve(root).startsWith(resolve(tmpdir(), 'agentwork-skill-test-')),
    );
    await rm(root, { recursive: true, force: true });
  });
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  const run = (args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  const setup = run(['codex-config', '--url', 'https://agentwork.example']);
  assert.ok(setup.configToml.includes(JSON.stringify(process.execPath)));
  assert.ok(
    setup.configToml.includes('AGENTWORK_URL = "https://agentwork.example"'),
  );
  const target = join(root, 'skill');
  const installed = run(['install-skill', '--directory', target]);
  assert.equal(
    await readFile(installed.path, 'utf8'),
    await readFile(setup.skillSource, 'utf8'),
  );
  const runtime = JSON.parse(await readFile(installed.runtimePath, 'utf8'));
  assert.equal(runtime.nodePath, process.execPath);
  assert.equal(runtime.cliPath, cli);
  assert.equal(run(['install-skill', '--directory', target]).installed, true);
  await writeFile(installed.path, 'Custom instructions');
  assert.throws(() => run(['install-skill', '--directory', target]));
  assert.equal(await readFile(installed.path, 'utf8'), 'Custom instructions');
});
