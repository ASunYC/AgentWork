import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  encryptRecovery,
  decryptRecovery,
  prepareDevice,
  createRecovery,
} from './recovery.mjs';
import { AgentWorkConnection } from './client.mjs';
import { openCredentials } from './secret-store.mjs';

function recoveryData() {
  const keys = generateKeyPairSync('ed25519');
  return {
    publicKey: keys.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString(),
    privateKey: keys.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    agentId: randomUUID(),
    platformUrl: 'https://agentwork.example',
  };
}
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'agentwork-recovery-test-'));
  t.after(async () => {
    assert.ok(
      resolve(root).startsWith(resolve(tmpdir(), 'agentwork-recovery-test-')),
    );
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('encrypted backups authenticate metadata and reject a wrong passphrase or modified ciphertext', () => {
  assert.throws(
    () =>
      openCredentials(
        { format: 'future-format', protected: 'data' },
        'https://agentwork.example',
      ),
    /Unsupported credential storage/,
  );
  const data = recoveryData();
  const password = 'correct passphrase with enough entropy';
  const backup = encryptRecovery(data, password);
  assert.doesNotMatch(JSON.stringify(backup), /PRIVATE KEY|privateKey/);
  assert.deepEqual(decryptRecovery(backup, password), data);
  assert.throws(
    () => decryptRecovery(backup, 'incorrect password'),
    /cannot be unlocked/,
  );
  assert.throws(
    () => decryptRecovery({ ...backup, agentId: randomUUID() }, password),
    /cannot be unlocked/,
  );
  assert.throws(
    () =>
      decryptRecovery(
        { ...backup, ciphertext: `AAAA${backup.ciphertext.slice(4)}` },
        password,
      ),
    /cannot be unlocked/,
  );
});

test('local Windows credentials are DPAPI protected and bound to the platform origin', async (t) => {
  const root = await temporary(t);
  const data = recoveryData();
  const state = {
    ...data,
    name: 'Test Agent',
    slug: 'test-agent',
    accessToken: 'aws_synthetic_test_token',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const client = new AgentWorkConnection(data.platformUrl, { home: root });
  await client.save(state);
  const raw = await readFile(client.statePath, 'utf8');
  if (process.platform === 'win32') {
    assert.doesNotMatch(raw, /PRIVATE KEY|aws_synthetic_test_token|privateKey/);
    assert.equal(JSON.parse(raw).format, 'agentwork-dpapi-v1');
    assert.throws(
      () => openCredentials(JSON.parse(raw), 'https://other.example'),
      /another AgentWork platform/,
    );
  }
  assert.deepEqual(
    await new AgentWorkConnection(data.platformUrl, { home: root }).load(),
    state,
  );
});

test('legacy credentials are upgraded on connection without changing the identity', async (t) => {
  const root = await temporary(t);
  const data = recoveryData();
  const state = {
    ...data,
    name: 'Legacy',
    slug: 'legacy',
    accessToken: 'aws_old_test_token',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const client = new AgentWorkConnection(data.platformUrl, {
    home: root,
    fetch: async () =>
      new Response(JSON.stringify({ agent: { id: data.agentId } })),
  });
  await mkdir(client.directory, { recursive: true });
  await writeFile(client.statePath, JSON.stringify(state));
  assert.equal((await client.connect()).agent.id, data.agentId);
  if (process.platform === 'win32')
    assert.doesNotMatch(
      await readFile(client.statePath, 'utf8'),
      /PRIVATE KEY|aws_old_test_token/,
    );
});

test('a credential file cannot masquerade as a public enrollment request', async (t) => {
  const root = await temporary(t);
  const data = recoveryData();
  const path = join(root, 'credentials.json');
  const credentials = JSON.stringify({
    publicKey: data.publicKey,
    privateKey: data.privateKey,
    label: 'Device',
  });
  await writeFile(path, credentials);
  const client = {
    directory: root,
    load: async () => ({ ...data, name: 'Device' }),
    save: async () => {},
  };
  await assert.rejects(
    prepareDevice(client, { label: 'Device', file: path }),
    /never exported/,
  );
  assert.equal(await readFile(path, 'utf8'), credentials);
});

test('backup creation preserves material across lost responses and will not replace another identity', async (t) => {
  const root = await temporary(t);
  const backup = join(root, 'backup.json');
  const passwordFile = join(root, 'passphrase');
  await writeFile(passwordFile, 'a long synthetic recovery passphrase');
  const agentId = randomUUID();
  const requests = [];
  let fail = true;
  const client = {
    url: 'https://agentwork.example',
    call: async (path, body) => {
      if (path.endsWith('/me')) return { agent: { id: agentId } };
      requests.push(body.publicKey);
      if (fail) {
        fail = false;
        throw new Error('Response lost');
      }
      return {
        configured: true,
        fingerprint: createHash('sha256').update(body.publicKey).digest('hex'),
      };
    },
  };
  await assert.rejects(
    createRecovery(client, { file: backup, passphraseFile: passwordFile }),
    /Response lost/,
  );
  const original = await readFile(backup, 'utf8');
  const result = await createRecovery(client, {
    file: backup,
    passphraseFile: passwordFile,
  });
  assert.equal(result.configured, true);
  assert.equal(requests[0], requests[1]);
  assert.equal(await readFile(backup, 'utf8'), original);
  const other = {
    ...client,
    call: async () => ({ agent: { id: randomUUID() } }),
  };
  await assert.rejects(
    createRecovery(other, { file: backup, passphraseFile: passwordFile }),
    /another Agent/,
  );
});
