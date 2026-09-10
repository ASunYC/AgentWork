import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign,
} from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { withFileLock, readJson } from './local-files.mjs';

const fingerprint = (key) => createHash('sha256').update(key).digest('hex');
const keyPair = () => {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKey: pair.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString(),
    privateKey: pair.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
  };
};
async function passphrase(path) {
  if (!path)
    throw new Error(
      'Provide --passphrase-file; do not pass the secret in command arguments or chat',
    );
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
    throw new Error('Passphrase file must be a small regular file');
  const secret = (await readFile(path, 'utf8')).trim();
  if (secret.length < 16)
    throw new Error('Use a recovery passphrase of at least 16 characters');
  return secret;
}
const aad = (envelope) =>
  Buffer.from(
    JSON.stringify({
      format: envelope.format,
      platformUrl: envelope.platformUrl,
      agentId: envelope.agentId,
      publicKey: envelope.publicKey,
    }),
  );
export function encryptRecovery(data, secret) {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const envelope = {
    format: 'agentwork-recovery-v1',
    platformUrl: data.platformUrl,
    agentId: data.agentId,
    publicKey: data.publicKey,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
  };
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(envelope));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  key.fill(0);
  return {
    ...envelope,
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}
export function decryptRecovery(envelope, secret) {
  try {
    if (
      envelope.format !== 'agentwork-recovery-v1' ||
      typeof envelope.ciphertext !== 'string' ||
      envelope.ciphertext.length > 16000
    )
      throw new Error('Invalid backup');
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16)
      throw new Error('Invalid envelope');
    const key = scryptSync(secret, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad(envelope));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    key.fill(0);
    const data = JSON.parse(plain.toString('utf8'));
    if (
      data.agentId !== envelope.agentId ||
      data.platformUrl !== envelope.platformUrl ||
      createPublicKey(data.privateKey)
        .export({ type: 'spki', format: 'pem' })
        .toString() !== envelope.publicKey
    )
      throw new Error('Invalid key binding');
    return data;
  } catch {
    throw new Error(
      'Recovery backup cannot be unlocked; check its passphrase and integrity',
    );
  }
}

export async function prepareDevice(client, options = {}) {
  if (!options.file || !options.label)
    throw new Error('Provide a device label and an output request file');
  await mkdir(client.directory, { recursive: true, mode: 0o700 });
  return withFileLock(join(client.directory, 'connection.lock'), async () => {
    let state = await client.load();
    if (state?.agent)
      throw new Error(
        'This profile already has an Agent; use a new AGENTWORK_HOME for a new device',
      );
    state ??= { ...keyPair(), name: options.label };
    state.slug ??= `device-${fingerprint(state.publicKey).slice(0, 16)}`;
    state.registrationAllowed = false;
    await client.save(state);
    const path = resolve(options.file);
    await mkdir(dirname(path), { recursive: true });
    const request = { publicKey: state.publicKey, label: options.label };
    try {
      await writeFile(path, `${JSON.stringify(request, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await lstat(path);
      const prior =
        stat.isFile() && !stat.isSymbolicLink() ? await readJson(path) : null;
      if (
        !prior ||
        Object.keys(prior).sort().join(',') !== 'label,publicKey' ||
        prior.publicKey !== request.publicKey ||
        prior.label !== request.label
      )
        throw new Error(
          'Request file already exists with different content; credentials are never exported as a public request',
        );
    }
    return {
      path,
      fingerprint: fingerprint(state.publicKey),
      message:
        'Authorize this public-key request from an existing device before connecting.',
    };
  });
}

export async function createRecovery(client, options = {}) {
  if (!options.file) throw new Error('Provide an encrypted backup file path');
  const secret = await passphrase(options.passphraseFile);
  const { agent } = await client.call('/v2/access/me');
  const path = resolve(options.file);
  await mkdir(dirname(path), { recursive: true });
  let envelope = await readJson(path);
  let data;
  if (envelope) {
    data = decryptRecovery(envelope, secret);
    if (data.agentId !== agent.id || data.platformUrl !== client.url)
      throw new Error('Backup belongs to another Agent or platform');
  } else {
    data = { ...keyPair(), agentId: agent.id, platformUrl: client.url };
    envelope = encryptRecovery(data, secret);
    // Write recovery material before registration so a lost response cannot lose the key.
    await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  }
  const result = await client.call('/v2/access/recovery', {
    publicKey: data.publicKey,
    replace: options.replace ?? false,
  });
  if (
    result.configured !== true ||
    result.fingerprint !== fingerprint(data.publicKey)
  )
    throw new Error(
      'The platform did not confirm this recovery key; keep the backup and retry',
    );
  return {
    path,
    agentId: agent.id,
    fingerprint: result.fingerprint,
    configured: true,
  };
}

export async function recoverIdentity(client, options = {}) {
  if (!options.file) throw new Error('Provide the encrypted recovery backup');
  const data = decryptRecovery(
    await readJson(resolve(options.file)),
    await passphrase(options.passphraseFile),
  );
  if (data.platformUrl !== client.url)
    throw new Error('Recovery backup belongs to another platform');
  await mkdir(client.directory, { recursive: true, mode: 0o700 });
  return withFileLock(join(client.directory, 'connection.lock'), async () => {
    let state = await client.load();
    if (state?.agent) {
      if (
        state.agent.id === data.agentId &&
        state.recoveryFingerprint === fingerprint(data.publicKey)
      ) {
        const connected = await client.connectUnlocked();
        if (connected.agent.id !== data.agentId)
          throw new Error('Recovered device authenticated as another Agent');
        return {
          ...connected,
          recovered: true,
          resumed: true,
        };
      }
      throw new Error(
        'Use an empty AGENTWORK_HOME to restore an Agent identity',
      );
    }
    if (state?.recoveryAgentId && state.recoveryAgentId !== data.agentId)
      throw new Error('This profile has another pending recovery');
    state ??= keyPair();
    state = {
      ...state,
      name: 'Recovered Agent',
      slug: `recovered-${fingerprint(state.publicKey).slice(0, 16)}`,
      registrationAllowed: false,
      recoveryAgentId: data.agentId,
      recoveryFingerprint: fingerprint(data.publicKey),
    };
    await client.save(state);
    const challenge = await client.request('/v2/access/recovery/challenge', {
      body: { agentId: data.agentId, publicKey: state.publicKey },
    });
    const message = JSON.parse(challenge.message);
    if (
      message.protocol !== 'agentwork-recovery-v2' ||
      message.audience !== client.url ||
      message.challengeId !== challenge.challengeId ||
      message.agentId !== data.agentId ||
      message.fingerprint !== fingerprint(state.publicKey) ||
      message.recoveryFingerprint !== fingerprint(data.publicKey) ||
      !Number.isFinite(Date.parse(message.expiresAt)) ||
      Date.parse(message.expiresAt) <= Date.now()
    )
      throw new Error('Untrusted recovery challenge');
    const signature = (key) =>
      sign(null, Buffer.from(challenge.message), key).toString('base64');
    const result = await client.request('/v2/access/recovery/complete', {
      body: {
        challengeId: challenge.challengeId,
        recoverySignature: signature(data.privateKey),
        deviceSignature: signature(state.privateKey),
      },
    });
    if (result.agent.id !== data.agentId)
      throw new Error('Recovery returned another Agent');
    await client.save({
      ...state,
      agent: result.agent,
      installationId: result.installationId,
      name: result.agent.name,
      slug: result.agent.slug,
    });
    const connected = await client.connectUnlocked();
    if (connected.agent.id !== data.agentId)
      throw new Error('Recovered device authenticated as another Agent');
    return { ...connected, recovered: true };
  });
}

export async function migrateLegacyIdentity(client, options = {}) {
  if (!options.agentId || !/^[0-9a-f-]{36}$/i.test(options.agentId))
    throw new Error('Provide the expected legacy Agent ID');
  await mkdir(client.directory, { recursive: true, mode: 0o700 });
  return withFileLock(join(client.directory, 'connection.lock'), async () => {
    let state = await client.load();
    const confirm = async () => {
      const connected = await client.connectUnlocked();
      if (connected.agent.id !== options.agentId)
        throw new Error('The device authenticated as another Agent');
      return { ...connected, migrated: true, resumed: true };
    };
    if (state?.agent) {
      if (state.agent.id !== options.agentId)
        throw new Error('Use an empty profile to migrate another Agent');
      return confirm();
    }
    if (state?.migrationAgentId && state.migrationAgentId !== options.agentId)
      throw new Error('Another identity migration is pending in this profile');
    if (state?.migrationAgentId === options.agentId) {
      try {
        return await confirm();
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    }
    if (!options.keyFile)
      throw new Error(
        'Provide --legacy-key-file; do not paste the key in chat or command arguments',
      );
    const stat = await lstat(options.keyFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
      throw new Error('Legacy key file must be a small regular file');
    const source = (await readFile(options.keyFile, 'utf8')).trim();
    const key = source.startsWith('{') ? JSON.parse(source).apiKey : source;
    if (typeof key !== 'string' || !key.startsWith('awk_'))
      throw new Error('Legacy Agent API key not found in the supplied file');
    state ??= keyPair();
    state = {
      ...state,
      name: 'Migrating Agent',
      slug: `migration-${fingerprint(state.publicKey).slice(0, 16)}`,
      registrationAllowed: false,
      migrationAgentId: options.agentId,
    };
    await client.save(state);
    const challenge = await client.request('/v2/access/challenge', {
      body: { name: state.name, slug: state.slug, publicKey: state.publicKey },
    });
    const message = JSON.parse(challenge.message);
    if (
      message.protocol !== 'agentwork-connect-v2' ||
      message.audience !== client.url ||
      message.challengeId !== challenge.challengeId ||
      message.fingerprint !== fingerprint(state.publicKey) ||
      message.name !== state.name ||
      message.slug !== state.slug ||
      !Number.isFinite(Date.parse(message.expiresAt)) ||
      Date.parse(message.expiresAt) <= Date.now()
    )
      throw new Error('Untrusted legacy migration challenge');
    const signature = sign(
      null,
      Buffer.from(challenge.message),
      state.privateKey,
    ).toString('base64');
    const result = await client.request('/v2/access/legacy-device', {
      token: key,
      body: {
        agentId: options.agentId,
        challengeId: challenge.challengeId,
        signature,
      },
    });
    if (result.agent.id !== options.agentId)
      throw new Error('Migration returned another Agent');
    await client.save({
      ...state,
      agent: result.agent,
      installationId: result.installationId,
      name: result.agent.name,
      slug: result.agent.slug,
    });
    return { ...(await confirm()), resumed: false };
  });
}
