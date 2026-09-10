import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  lstat,
  readFile,
  realpath,
  writeFile,
  rename,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import {
  workCreateSchema,
  workEditSchema,
  roadmapCreateSchema,
  roadmapEditSchema,
  defectCreateSchema,
} from '@agentwork/contracts';
import { findProjectBinding } from './workspace.mjs';
import { readJson, writeJson, withFileLock } from './local-files.mjs';
import { trellisFiles, mergeTrellisTask } from './trellis.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const schemas = {
  'task.create': workCreateSchema,
  'task.edit': workEditSchema,
  'roadmap.create': roadmapCreateSchema,
  'roadmap.edit': roadmapEditSchema,
  'defect.create': defectCreateSchema,
};
const routes = {
  'task.create': () => '/tasks',
  'task.edit': (id) => `/tasks/${id}/edit`,
  'roadmap.create': () => '/roadmaps',
  'roadmap.edit': (id) => `/roadmaps/${id}/edit`,
  'defect.create': () => '/defects',
};

async function info(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function syncLocation(client, options) {
  const binding = await findProjectBinding(options.directory);
  if (
    !binding ||
    binding.platformUrl !== client.url ||
    (options.projectId && options.projectId !== binding.projectId)
  )
    throw new Error(
      'Sync requires a repository bound to the selected platform and project',
    );
  const directory = await realpath(binding.directory);
  const stateDirectory = join(client.directory, 'sync');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const statePath = join(
    stateDirectory,
    `${hash(`${directory}:${binding.projectId}`)}.json`,
  );
  return { directory, statePath, projectId: binding.projectId };
}

async function safeProjectionPath(directory, name) {
  if (
    !name.startsWith('.trellis/') ||
    name
      .split('/')
      .some(
        (p) =>
          !p || p === '.' || p === '..' || p.includes(':') || p.includes('\\'),
      )
  )
    throw new Error('Invalid projection path');
  const path = resolve(directory, name);
  const within = relative(directory, path);
  if (isAbsolute(within) || within.startsWith('..'))
    throw new Error('Projection escapes the repository');
  let current = directory;
  for (const segment of name.split('/')) {
    current = join(current, segment);
    if ((await info(current))?.isSymbolicLink())
      throw new Error(`Projection path contains a symlink: ${name}`);
  }
  return path;
}

async function fileContent(path) {
  const stat = await info(path);
  if (!stat) return null;
  if (!stat.isFile())
    throw new Error('Projection target must be a regular file');
  return readFile(path, 'utf8');
}

async function applyPending(location, state) {
  const pending = state.pendingPull;
  if (!pending) return;
  // Check every path before writing any of them. A partial prior pull may already
  // have written the new content, but neither generation may overwrite a third value.
  for (const file of pending.files) {
    const path = await safeProjectionPath(location.directory, file.name);
    const content = await fileContent(path);
    const currentHash = content === null ? null : hash(content);
    if (currentHash !== file.beforeHash && currentHash !== hash(file.content))
      throw new Error(`Interrupted pull has a local conflict: ${file.name}`);
  }
  for (const file of pending.files) {
    const path = await safeProjectionPath(location.directory, file.name);
    await mkdir(dirname(path), { recursive: true });
    const content = await fileContent(path);
    if (content !== file.content) {
      const temporary = `${path}.aw-${randomUUID()}.tmp`;
      await writeFile(temporary, file.content, { flag: 'wx' });
      await rename(temporary, path);
    }
  }
  state.snapshot = pending.snapshot;
  state.managed = {
    ...state.managed,
    ...Object.fromEntries(
      pending.files.map((file) => [file.name, hash(file.content)]),
    ),
  };
  delete state.pendingPull;
  await writeJson(location.statePath, state);
}

export async function pullProject(client, options = {}) {
  const location = await syncLocation(client, options);
  return withFileLock(`${location.statePath}.lock`, async () => {
    const state = (await readJson(location.statePath)) ?? {
      projectId: location.projectId,
      managed: {},
      queue: [],
    };
    await applyPending(location, state);
    const snapshot = await client.call(
      `/v2/projects/${location.projectId}/context`,
    );
    if (snapshot.project?.id !== location.projectId)
      throw new Error('Snapshot belongs to another project');
    const projections = trellisFiles(snapshot);
    const manifestName = '.trellis/agentwork.json';
    if (!state.snapshot) {
      const manifestPath = await safeProjectionPath(
        location.directory,
        manifestName,
      );
      const portableText = await fileContent(manifestPath);
      if (portableText) {
        const portable = JSON.parse(portableText);
        if (
          portable.adapterVersion === 1 &&
          portable.projectId === location.projectId &&
          portable.managed &&
          typeof portable.managed === 'object'
        ) {
          state.managed = {
            ...portable.managed,
            [manifestName]: hash(portableText),
          };
        }
      }
    }
    const baselineFiles = state.snapshot ? trellisFiles(state.snapshot) : {};
    const files = [];
    const conflicts = [];
    const backups = {};
    for (const [name, generated] of Object.entries(projections)) {
      let content = generated;
      const path = await safeProjectionPath(location.directory, name);
      const previous = await fileContent(path);
      const currentHash = previous === null ? null : hash(previous);
      const baseline = state.managed[name];
      let modified = baseline ? currentHash !== baseline : previous !== null;
      if (baseline && previous !== null && name.endsWith('/task.json')) {
        try {
          const merged = mergeTrellisTask(
            generated,
            previous,
            baselineFiles[name] ??
              (currentHash === baseline ? previous : generated),
          );
          content = merged.content;
          modified = merged.conflict;
        } catch {
          /* Malformed local JSON remains a conflict and is only replaced with an explicit backup. */
        }
      }
      if (modified && previous !== content) {
        if (!options.acceptRemote || !baseline) conflicts.push(name);
        else backups[name] = previous;
      }
      files.push({ name, content, beforeHash: currentHash });
    }
    if (conflicts.length)
      throw new Error(
        `Local changes conflict with pull; no projection files changed: ${conflicts.join(', ')}. Preserve/stage your changes first. --accept-remote only replaces previously managed files and saves a backup.`,
      );
    const manifest = files.find((file) => file.name === manifestName);
    manifest.content = `${JSON.stringify({ ...JSON.parse(manifest.content), managed: Object.fromEntries(files.filter((file) => file.name !== manifestName).map((file) => [file.name, hash(file.content)])) }, null, 2)}\n`;
    let backupPath;
    if (Object.keys(backups).length) {
      backupPath = `${location.statePath}.backup-${randomUUID()}.json`;
      await writeJson(backupPath, backups);
    }
    state.pendingPull = { snapshot, files };
    await writeJson(location.statePath, state);
    await applyPending(location, state);
    return {
      projectId: location.projectId,
      snapshotVersion: snapshot.snapshotVersion,
      tasks: snapshot.project.workItems.length,
      files: files.length,
      backupPath,
      directory: location.directory,
    };
  });
}

function parseChange(change) {
  if (!change || !Object.hasOwn(schemas, change.kind))
    throw new Error(
      'Only task/Roadmap planning changes and defect reports may be queued. Claim and review require a live platform command.',
    );
  if (
    change.kind.endsWith('.edit') &&
    !/^[0-9a-f-]{36}$/i.test(change.resourceId ?? '')
  )
    throw new Error('An existing resourceId is required for edits');
  const input = schemas[change.kind].parse(change.input);
  return { kind: change.kind, resourceId: change.resourceId, input };
}

export async function stageChange(client, change, options = {}) {
  const parsed = parseChange(change);
  const location = await syncLocation(client, options);
  return withFileLock(`${location.statePath}.lock`, async () => {
    const state = await readJson(location.statePath);
    if (!state?.snapshot)
      throw new Error('Pull a project snapshot before staging offline changes');
    const idempotencyKey = change.idempotencyKey ?? randomUUID();
    if (!/^[a-zA-Z0-9_:-]{8,120}$/.test(idempotencyKey))
      throw new Error('Invalid idempotency key');
    const prior = state.queue.find(
      (item) => item.idempotencyKey === idempotencyKey,
    );
    if (prior) {
      if (JSON.stringify(prior.change) !== JSON.stringify(parsed))
        throw new Error(
          'This idempotency key belongs to a different staged change',
        );
      return { id: prior.id, status: prior.status, idempotencyKey };
    }
    if (state.queue.filter((item) => item.status === 'pending').length >= 1000)
      throw new Error('Push or discard pending changes before staging more');
    const entry = {
      id: randomUUID(),
      idempotencyKey,
      change: parsed,
      status: 'pending',
      attempted: false,
      uncertain: false,
    };
    state.queue.push(entry);
    await writeJson(location.statePath, state);
    return {
      id: entry.id,
      status: 'pending',
      idempotencyKey,
      message: 'Staged locally; no platform change has been made.',
    };
  });
}

export async function pushChanges(client, options = {}) {
  const location = await syncLocation(client, options);
  const maxChanges = options.maxChanges ?? 20;
  if (!Number.isInteger(maxChanges) || maxChanges < 1 || maxChanges > 100)
    throw new Error('maxChanges must be between 1 and 100');
  return withFileLock(`${location.statePath}.lock`, async () => {
    const state = await readJson(location.statePath);
    if (!state?.snapshot) throw new Error('Pull a project snapshot first');
    const selected = options.changeIds ? new Set(options.changeIds) : null;
    if (
      selected &&
      (!selected.size ||
        selected.size > 100 ||
        [...selected].some(
          (id) =>
            !state.queue.some(
              (entry) => entry.id === id && entry.status !== 'discarded',
            ),
        ))
    )
      throw new Error('Select existing pending or applied change IDs');
    const applied = [];
    for (const entry of state.queue
      .filter(
        (item) =>
          item.status === 'pending' && (!selected || selected.has(item.id)),
      )
      .slice(0, maxChanges)) {
      const change = parseChange(entry.change);
      entry.attempted = true;
      // Persist uncertainty before sending: a process can stop after the server commits.
      entry.uncertain = true;
      await writeJson(location.statePath, state);
      try {
        const result = await client.call(
          `/v2/projects/${location.projectId}${routes[change.kind](change.resourceId)}`,
          change.input,
          entry.idempotencyKey,
        );
        entry.status = 'applied';
        entry.uncertain = false;
        entry.result = result;
        delete entry.error;
        applied.push({ id: entry.id, result });
      } catch (error) {
        entry.error = {
          status: error.status ?? null,
          code: error.code ?? null,
          message: error.message,
        };
        if (
          [400, 409].includes(error.status) &&
          error.code !== 'IDEMPOTENCY_CONFLICT'
        )
          entry.uncertain = false;
        await writeJson(location.statePath, state);
        throw new Error(
          `Sync stopped after ${applied.length} applied change(s). Change ${entry.id}: ${error.message}. Its key and input are preserved; retry unchanged or inspect sync-status before rebasing.`,
        );
      }
      await writeJson(location.statePath, state);
    }
    return {
      applied,
      remaining: state.queue.filter(
        (item) =>
          item.status === 'pending' && (!selected || selected.has(item.id)),
      ).length,
      totalPending: state.queue.filter((item) => item.status === 'pending')
        .length,
      message: 'Pull to refresh the local snapshot and Trellis projections.',
    };
  });
}

export async function syncStatus(client, options = {}) {
  const location = await syncLocation(client, options);
  const state = await readJson(location.statePath);
  return {
    projectId: location.projectId,
    snapshotVersion: state?.snapshot?.snapshotVersion ?? null,
    interruptedPull: !!state?.pendingPull,
    changes: (state?.queue ?? []).map(
      ({ id, status, change, error, uncertain, result }) => ({
        id,
        status,
        kind: change.kind,
        resourceId: change.resourceId ?? result?.id,
        resultVersion: result?.version,
        error,
        uncertain,
      }),
    ),
  };
}

export async function discardChange(client, changeId, options = {}) {
  const location = await syncLocation(client, options);
  return withFileLock(`${location.statePath}.lock`, async () => {
    const state = await readJson(location.statePath);
    const entry = state?.queue.find((item) => item.id === changeId);
    if (!entry || entry.status !== 'pending')
      throw new Error('Pending change not found');
    if (entry.uncertain)
      throw new Error(
        'This request may already have committed. Replay its original key before discarding it.',
      );
    entry.status = 'discarded';
    await writeJson(location.statePath, state);
    return { id: entry.id, status: entry.status };
  });
}
