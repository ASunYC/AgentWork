import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
  cp,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  pullProject,
  stageChange,
  pushChanges,
  syncStatus,
  discardChange,
} from './sync.mjs';

test('scoped push leaves unrelated queued work untouched', async (t) => {
  const f = await fixture(t);
  await pullProject(f.client, f.options);
  const a = await stageChange(
    f.client,
    {
      kind: 'task.create',
      input: {
        title: 'Selected work',
        description: 'Goal',
        acceptanceCriteria: 'Done',
      },
    },
    f.options,
  );
  const b = await stageChange(
    f.client,
    {
      kind: 'task.create',
      input: {
        title: 'Unrelated work',
        description: 'Other goal',
        acceptanceCriteria: 'Later',
      },
    },
    f.options,
  );
  const result = await pushChanges(f.client, {
    ...f.options,
    changeIds: [a.id],
  });
  assert.equal(result.remaining, 0);
  assert.equal(result.totalPending, 1);
  assert.equal(
    (await syncStatus(f.client, f.options)).changes.find((c) => c.id === a.id)
      .resourceId,
    f.taskId,
  );
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.title, 'Selected work');
  assert.equal(
    (await syncStatus(f.client, f.options)).changes.find((c) => c.id === b.id)
      .status,
    'pending',
  );
});

test('sync preserves native Trellis metadata and cloned managed files can bootstrap a fresh local snapshot', async (t) => {
  const f = await fixture(t);
  await pullProject(f.client, f.options);
  const task = JSON.parse(await readFile(f.taskPath, 'utf8'));
  task.branch = 'codex/local-work';
  task.notes = 'Keep my journal';
  task.meta.custom = { designLink: 'local-reference' };
  await writeFile(f.taskPath, JSON.stringify(task));
  f.task.title = 'Updated platform title';
  f.snapshot.project.version++;
  f.snapshot.snapshotVersion++;
  await pullProject(f.client, f.options);
  const merged = JSON.parse(await readFile(f.taskPath, 'utf8'));
  assert.equal(merged.branch, 'codex/local-work');
  assert.equal(merged.notes, 'Keep my journal');
  assert.equal(merged.title, 'Updated platform title');
  assert.deepEqual(merged.meta.custom, { designLink: 'local-reference' });
  const clone = join(f.root, 'clone');
  await cp(f.directory, clone, { recursive: true });
  f.task.title = 'A newer remote version';
  f.snapshot.project.version++;
  f.snapshot.snapshotVersion++;
  const client = { ...f.client, directory: join(f.root, 'another-profile') };
  await pullProject(client, { directory: clone });
  const fresh = JSON.parse(
    await readFile(
      join(clone, '.trellis', 'tasks', `aw-${f.taskId}`, 'task.json'),
      'utf8',
    ),
  );
  assert.equal(fresh.title, 'A newer remote version');
  assert.equal(fresh.branch, 'codex/local-work');
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agentwork-sync-test-'));
  t.after(async () => {
    assert.ok(
      resolve(root).startsWith(resolve(tmpdir(), 'agentwork-sync-test-')),
    );
    await rm(root, { recursive: true, force: true });
  });
  const directory = join(root, 'repo');
  const projectId = randomUUID();
  const taskId = randomUUID();
  await mkdir(join(directory, '.agentwork'), { recursive: true });
  await writeFile(
    join(directory, '.agentwork', 'project.json'),
    JSON.stringify({
      platformUrl: 'http://localhost:3001',
      projectId,
      protocolVersion: 2,
    }),
  );
  const task = {
    id: taskId,
    title: 'Initial task',
    description: 'Original scope',
    acceptanceCriteria: 'Tests pass',
    status: 'READY',
    priority: 'HIGH',
    category: 'DEVELOPMENT',
    version: 1,
    creatorAgentId: randomUUID(),
    assigneeAgentId: null,
    parentId: null,
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    dependencies: [],
  };
  const snapshot = {
    protocolVersion: 2,
    snapshotVersion: 3,
    project: {
      id: projectId,
      name: 'Sync project',
      description: 'Shared goal',
      gitUrl: 'git@private.example:secret/repo.git',
      version: 3,
      defaultBranch: 'main',
      members: [],
      roadmaps: [],
      workItems: [task],
      defects: [],
    },
  };
  const calls = [];
  const results = new Map();
  let loseResponse = false;
  let offline = false;
  const client = {
    url: 'http://localhost:3001',
    directory: join(root, 'profile'),
    call: async (path, body, key) => {
      if (offline) throw new Error('Offline');
      if (path.endsWith('/context')) return structuredClone(snapshot);
      calls.push({ path, body, key });
      if (results.has(key)) return results.get(key);
      if (
        body.expectedVersion !== undefined &&
        body.expectedVersion !== task.version
      )
        throw Object.assign(new Error('Task version changed'), {
          status: 409,
          code: 'VERSION_CONFLICT',
        });
      if (body.patch) {
        Object.assign(task, body.patch);
        task.version++;
        snapshot.snapshotVersion++;
        snapshot.project.version++;
      }
      const result = structuredClone(task);
      results.set(key, result);
      if (loseResponse) {
        loseResponse = false;
        throw new Error('Response lost after commit');
      }
      return result;
    },
  };
  return {
    root,
    directory,
    projectId,
    taskId,
    task,
    snapshot,
    client,
    calls,
    results,
    options: { directory },
    lose: () => {
      loseResponse = true;
    },
    offline: (value) => {
      offline = value;
    },
    taskPath: join(directory, '.trellis', 'tasks', `aw-${taskId}`, 'task.json'),
  };
}

test('pull exports versioned Trellis tasks and preserves unrelated files and private repository metadata', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.directory, '.trellis', 'spec'), { recursive: true });
  await writeFile(
    join(f.directory, '.trellis', 'spec', 'custom.md'),
    'Team conventions',
  );
  const result = await pullProject(f.client, f.options);
  assert.equal(result.snapshotVersion, 3);
  const task = JSON.parse(await readFile(f.taskPath, 'utf8'));
  assert.equal(task.status, 'planning');
  assert.equal(task.priority, 'P1');
  assert.equal(task.meta.agentwork.taskId, f.taskId);
  assert.equal(task.meta.agentwork.version, 1);
  const spec = await readFile(
    join(f.directory, '.trellis', 'spec', 'agentwork', 'index.md'),
    'utf8',
  );
  assert.doesNotMatch(spec, /private.example|secret/);
  assert.equal(
    await readFile(join(f.directory, '.trellis', 'spec', 'custom.md'), 'utf8'),
    'Team conventions',
  );
});

test('pull detects local conflicts before any projection update and explicit replacement saves the local edits', async (t) => {
  const f = await fixture(t);
  await pullProject(f.client, f.options);
  const local = JSON.parse(await readFile(f.taskPath, 'utf8'));
  local.title = 'Local notes';
  await writeFile(f.taskPath, JSON.stringify(local));
  f.task.title = 'Remote correction';
  f.snapshot.project.version++;
  f.snapshot.snapshotVersion++;
  await assert.rejects(
    pullProject(f.client, f.options),
    /Local changes conflict/,
  );
  assert.equal(
    JSON.parse(await readFile(f.taskPath, 'utf8')).title,
    'Local notes',
  );
  assert.equal((await syncStatus(f.client, f.options)).snapshotVersion, 3);
  const result = await pullProject(f.client, {
    ...f.options,
    acceptRemote: true,
  });
  assert.equal(
    JSON.parse(await readFile(f.taskPath, 'utf8')).title,
    'Remote correction',
  );
  const backup = JSON.parse(await readFile(result.backupPath, 'utf8'));
  assert.match(Object.values(backup).join(''), /Local notes/);
});

test('offline staging cannot claim tasks and uncertain writes replay the original key exactly once', async (t) => {
  const f = await fixture(t);
  await pullProject(f.client, f.options);
  f.offline(true);
  const change = await stageChange(
    f.client,
    {
      kind: 'task.edit',
      resourceId: f.taskId,
      input: {
        expectedVersion: 1,
        reason: 'New requirement',
        patch: { title: 'Queued correction' },
      },
    },
    f.options,
  );
  assert.equal(f.calls.length, 0);
  await assert.rejects(
    stageChange(f.client, { kind: 'task.claim', input: {} }, f.options),
    /live platform/,
  );
  assert.equal(
    (await syncStatus(f.client, f.options)).changes[0].status,
    'pending',
  );
  f.offline(false);
  f.lose();
  await assert.rejects(pushChanges(f.client, f.options), /Response lost/);
  await assert.rejects(
    discardChange(f.client, change.id, f.options),
    /may already have committed/,
  );
  const pushed = await pushChanges(f.client, f.options);
  assert.equal(pushed.remaining, 0);
  assert.equal(f.task.version, 2);
  assert.equal(f.calls[0].key, f.calls[1].key);
  assert.equal(f.results.size, 1);
  await pullProject(f.client, f.options);
  assert.equal(
    JSON.parse(await readFile(f.taskPath, 'utf8')).title,
    'Queued correction',
  );
});

test('version conflicts remain pending and can be explicitly discarded without overwriting remote work', async (t) => {
  const f = await fixture(t);
  await pullProject(f.client, f.options);
  const change = await stageChange(
    f.client,
    {
      kind: 'task.edit',
      resourceId: f.taskId,
      input: {
        expectedVersion: 1,
        reason: 'Local change',
        patch: { title: 'Stale edit' },
      },
    },
    f.options,
  );
  f.task.version = 2;
  f.task.title = 'Another Agent edit';
  await assert.rejects(pushChanges(f.client, f.options), /version changed/);
  const status = await syncStatus(f.client, f.options);
  assert.equal(status.changes[0].error.code, 'VERSION_CONFLICT');
  assert.equal(status.changes[0].uncertain, false);
  await discardChange(f.client, change.id, f.options);
  assert.equal(f.task.title, 'Another Agent edit');
});

test('an interrupted multi-file pull resumes from its journal without replacing later local edits', async (t) => {
  const f = await fixture(t);
  await pullProject(f.client, f.options);
  const folder = join(f.client.directory, 'sync');
  const path = join(
    folder,
    (await readdir(folder)).find((name) => name.endsWith('.json')),
  );
  const state = JSON.parse(await readFile(path, 'utf8'));
  const fileName = `.trellis/tasks/aw-${f.taskId}/prd.md`;
  const old = await readFile(join(f.directory, fileName), 'utf8');
  state.pendingPull = {
    snapshot: state.snapshot,
    files: [
      { name: fileName, beforeHash: state.managed[fileName], content: old },
    ],
  };
  await writeFile(path, JSON.stringify(state));
  await writeFile(
    join(f.directory, fileName),
    'Manual edit after interruption',
  );
  await assert.rejects(
    pullProject(f.client, f.options),
    /Interrupted pull has a local conflict/,
  );
  assert.equal(
    await readFile(join(f.directory, fileName), 'utf8'),
    'Manual edit after interruption',
  );
  await writeFile(join(f.directory, fileName), old);
  await pullProject(f.client, f.options);
  assert.equal((await syncStatus(f.client, f.options)).interruptedPull, false);
});

test('sync refuses symlink escape and mismatched project bindings', async (t) => {
  const f = await fixture(t);
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  await symlink(
    outside,
    join(f.directory, '.trellis'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(pullProject(f.client, f.options), /symlink/);
  assert.deepEqual(await readdir(outside), []);
  await assert.rejects(
    syncStatus(f.client, { ...f.options, projectId: randomUUID() }),
    /bound to the selected/,
  );
});
