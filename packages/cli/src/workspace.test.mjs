import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeProject, findProjectBinding } from './workspace.mjs';
import { withFileLock } from './local-files.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agentwork-workspace-'));
  t.after(async () => {
    assert.ok(
      resolve(root).startsWith(resolve(tmpdir(), 'agentwork-workspace-')),
    );
    await rm(root, { recursive: true, force: true });
  });
  const bare = join(root, 'remote.git');
  const git = (...args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '--bare', '--initial-branch=main', bare);
  const env = {
    ...process.env,
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(bare).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/agentwork-test/project.git',
  };
  const input = {
    name: 'Workspace project',
    slug: 'workspace-project',
    description: 'Local Git integration',
    categories: ['DEVELOPMENT'],
    gitUrl: 'https://github.com/agentwork-test/project.git',
    defaultBranch: 'main',
    joinPolicy: 'INVITE',
    reviewPolicy: 'INDEPENDENT',
  };
  const calls = [];
  const project = {
    id: '33333333-3333-4333-8333-333333333333',
    slug: input.slug,
  };
  const client = {
    url: 'http://localhost:3001',
    directory: join(root, 'profile'),
    call: async (path, body, key) => {
      if (path.endsWith('/validate')) return body;
      if (path.endsWith('/access/me'))
        return {
          agent: {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Workspace Agent',
          },
        };
      if (path === '/v2/projects') {
        calls.push({ body, key });
        return project;
      }
      throw new Error(`Unexpected API path: ${path}`);
    },
  };
  return {
    root,
    bare,
    git,
    env,
    input,
    calls,
    client,
    project,
    directory: join(root, 'new-project'),
  };
}

test('initializes and pushes a real Git repository, persists project binding, and resumes without duplicates', async (t) => {
  const f = await fixture(t);
  const result = await initializeProject(f.client, f.input, {
    directory: f.directory,
    env: f.env,
  });
  assert.equal(result.stage, 'READY');
  assert.equal(f.calls.length, 1);
  assert.equal(f.git('--git-dir', f.bare, 'rev-parse', 'main'), result.commit);
  assert.equal(f.git('--git-dir', f.bare, 'rev-list', '--count', 'main'), '2');
  const binding = JSON.parse(
    f.git('--git-dir', f.bare, 'show', 'main:.agentwork/project.json'),
  );
  assert.equal(binding.projectId, f.project.id);
  await mkdir(join(f.directory, 'src'));
  assert.equal(
    (await findProjectBinding(join(f.directory, 'src'))).projectId,
    f.project.id,
  );
  const resumed = await initializeProject(f.client, f.input, {
    directory: f.directory,
    env: f.env,
  });
  assert.equal(resumed.resumed, true);
  assert.equal(f.calls.length, 1);
  await assert.rejects(
    initializeProject(
      f.client,
      { ...f.input, name: 'Different project' },
      { directory: f.directory, env: f.env },
    ),
    /different initialization/,
  );
});

test('retries a lost platform response using the same operation key and keeps the existing Git history', async (t) => {
  const f = await fixture(t);
  const call = f.client.call;
  let fail = true;
  f.client.call = async (...args) => {
    const result = await call(...args);
    if (args[0] === '/v2/projects' && fail) {
      fail = false;
      throw new Error('Simulated response loss');
    }
    return result;
  };
  await assert.rejects(
    initializeProject(f.client, f.input, {
      directory: f.directory,
      env: f.env,
    }),
    /stage PUSHED/,
  );
  assert.equal(f.git('--git-dir', f.bare, 'rev-list', '--count', 'main'), '1');
  await initializeProject(f.client, f.input, {
    directory: f.directory,
    env: f.env,
  });
  assert.equal(f.calls[0].key, f.calls[1].key);
  assert.equal(f.git('--git-dir', f.bare, 'rev-list', '--count', 'main'), '2');
});

test('refuses existing directories and remote repositories with unrelated branches', async (t) => {
  const f = await fixture(t);
  await mkdir(f.directory);
  await writeFile(join(f.directory, 'keep.txt'), 'Keep me');
  await assert.rejects(
    initializeProject(f.client, f.input, {
      directory: f.directory,
      env: f.env,
    }),
    /already exists/,
  );
  assert.equal(
    await readFile(join(f.directory, 'keep.txt'), 'utf8'),
    'Keep me',
  );
  const seed = join(f.root, 'seed');
  f.git('init', '--initial-branch=other', seed);
  f.git(
    '-C',
    seed,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgSign=false',
    'commit',
    '--allow-empty',
    '-m',
    'Existing history',
  );
  f.git('-C', seed, 'push', f.bare, 'HEAD:refs/heads/other');
  const before = f.git('--git-dir', f.bare, 'rev-parse', 'other');
  await assert.rejects(
    initializeProject(f.client, f.input, {
      directory: join(f.root, 'another'),
      env: f.env,
    }),
    /unrelated history/,
  );
  assert.equal(f.git('--git-dir', f.bare, 'rev-parse', 'other'), before);
  assert.equal(f.git('--git-dir', f.bare, 'branch', '--list', 'main'), '');
  assert.equal(f.calls.length, 0);
});

test('local operation lock excludes concurrent writers', async (t) => {
  const f = await fixture(t);
  const path = join(f.root, 'operation.lock');
  await withFileLock(path, async () => {
    await assert.rejects(
      withFileLock(path, async () => assert.fail('Concurrent writer entered')),
      /Another local operation/,
    );
  });
  assert.equal(await withFileLock(path, async () => 'released'), 'released');
});

test('GitHub creation is explicit, private by default, and an uncertain result does not trigger another create', async (t) => {
  const f = await fixture(t);
  const calls = [];
  const githubCommand = async (args) => {
    calls.push(args);
    if (args[0] === 'repo') throw new Error('Creation response lost');
    return '';
  };
  const options = {
    directory: f.directory,
    env: f.env,
    createRemote: 'agentwork-test/project',
    githubCommand,
  };
  await assert.rejects(
    initializeProject(f.client, f.input, options),
    /Creation response lost/,
  );
  assert.deepEqual(calls, [
    ['auth', 'status', '--hostname', 'github.com'],
    ['repo', 'create', 'agentwork-test/project', '--private'],
  ]);
  await assert.rejects(
    initializeProject(f.client, f.input, options),
    /uncertain result/,
  );
  assert.equal(calls.length, 2);
  const recovered = await initializeProject(f.client, f.input, {
    ...options,
    useExistingRemote: true,
  });
  assert.equal(recovered.stage, 'READY');
  assert.equal(calls.length, 2);
});
