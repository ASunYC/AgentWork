// Optional interoperability gate against an independently downloaded, integrity-checked
// @mindfoldhq/trellis 0.6.16 package. No upstream source is bundled in AgentWork.
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { trellisFiles, TRELLIS_COMPATIBILITY } from '../src/trellis.mjs';

const { values } = parseArgs({
  options: { script: { type: 'string' }, python: { type: 'string' } },
});
if (!values.script || !values.python)
  throw new Error(
    'Provide --script PATH_TO_UPSTREAM_TASK_PY --python PYTHON_EXECUTABLE',
  );
const script = resolve(values.script);
const metadata = JSON.parse(
  await readFile(resolve(dirname(script), '../../../../package.json'), 'utf8'),
);
assert.equal(metadata.name, TRELLIS_COMPATIBILITY.package);
assert.equal(metadata.version, TRELLIS_COMPATIBILITY.version);
const directory = await mkdtemp(join(tmpdir(), 'agentwork-trellis-interop-'));
try {
  const parentId = randomUUID();
  const childId = randomUUID();
  const task = {
    title: 'Interoperable parent',
    description: 'Goal',
    acceptanceCriteria: 'Verified',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    category: 'DEVELOPMENT',
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    version: 1,
    creatorAgentId: 'agent',
    assigneeAgentId: 'agent',
    dependencies: [],
  };
  const files = trellisFiles({
    snapshotVersion: 5,
    project: {
      id: randomUUID(),
      name: 'Interop project',
      description: 'Verify task format',
      version: 5,
      defaultBranch: 'main',
      roadmaps: [],
      workItems: [
        { ...task, id: parentId, parentId: null },
        {
          ...task,
          id: childId,
          parentId,
          title: 'Interoperable child',
          status: 'IN_REVIEW',
        },
      ],
    },
  });
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  const { stdout } = await promisify(execFile)(
    values.python,
    [script, 'list', '--json'],
    {
      cwd: directory,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    },
  );
  const listed = JSON.parse(stdout).tasks;
  assert.equal(listed.length, 2);
  assert.deepEqual(listed.find((t) => t.id === `aw-${parentId}`).children, [
    `aw-${childId}`,
  ]);
  assert.equal(listed.find((t) => t.id === `aw-${childId}`).status, 'review');
  assert.equal(
    listed.find((t) => t.id === `aw-${childId}`).parent,
    `aw-${parentId}`,
  );
  console.log(
    `Verified task-file interoperability with ${metadata.name} ${metadata.version}`,
  );
} finally {
  assert.ok(
    resolve(directory).startsWith(
      resolve(tmpdir(), 'agentwork-trellis-interop-'),
    ),
  );
  await rm(directory, { recursive: true, force: true });
}
