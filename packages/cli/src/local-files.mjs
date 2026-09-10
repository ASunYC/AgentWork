import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function writeJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  await rename(temp, path);
}

export async function withFileLock(path, execute) {
  let lock;
  try {
    lock = await open(path, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = await readJson(path);
    if (!owner?.pid)
      throw new Error(
        'Incomplete operation lock; inspect the local lock before retrying',
      );
    try {
      process.kill(owner.pid, 0);
    } catch (probe) {
      if (probe.code === 'ESRCH') {
        // Only reclaim a lock whose recorded process is demonstrably gone.
        if ((await readJson(path))?.nonce === owner.nonce) await unlink(path);
        return withFileLock(path, execute);
      }
    }
    throw new Error(
      `Another local operation is active (process ${owner.pid}); retry after it finishes`,
    );
  }
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, nonce: randomUUID() }),
    );
    return await execute();
  } finally {
    await lock.close();
    await unlink(path);
  }
}
