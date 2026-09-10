import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { withFileLock } from './local-files.mjs';
import { sealCredentials, openCredentials } from './secret-store.mjs';

export function platformUrl(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Platform URL must be an origin without credentials');
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  )
    throw new Error('Use HTTPS for remote platforms');
  return url.origin;
}

export class AgentWorkConnection {
  constructor(url, options = {}) {
    this.url = platformUrl(url);
    this.fetch = options.fetch ?? globalThis.fetch;
    const originId = createHash('sha256')
      .update(this.url)
      .digest('hex')
      .slice(0, 24);
    this.directory = join(
      options.home ??
        process.env.AGENTWORK_HOME ??
        join(homedir(), '.agentwork'),
      originId,
    );
    this.statePath = join(this.directory, 'credentials.json');
  }

  async load() {
    try {
      const record = JSON.parse(await readFile(this.statePath, 'utf8'));
      this.needsProtection =
        process.platform === 'win32' && record.format !== 'agentwork-dpapi-v1';
      if (record.protected && record.protected === this.cachedBlob)
        return structuredClone(this.cachedState);
      const state = openCredentials(record, this.url);
      this.cachedBlob = record.protected;
      this.cachedState = structuredClone(state);
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(state) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') {
      const account = execFileSync('whoami.exe', [], {
        encoding: 'utf8',
        windowsHide: true,
      }).trim();
      execFileSync(
        'icacls.exe',
        [this.directory, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`],
        { stdio: 'pipe', windowsHide: true },
      );
    } else await chmod(this.directory, 0o700);
    const temporary = join(this.directory, `credentials-${randomUUID()}.tmp`);
    const stored = sealCredentials(state, this.url);
    await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, this.statePath);
    this.cachedBlob = stored.protected;
    this.cachedState = structuredClone(state);
    this.needsProtection = false;
  }

  async request(path, { body, token, key, method } = {}) {
    if (!path.startsWith('/v2/'))
      throw new Error('Only V2 API paths are supported');
    const response = await this.fetch(`${this.url}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      redirect: 'error',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(key ? { 'idempotency-key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.message ?? `HTTP ${response.status}`);
      error.status = response.status;
      error.code = result.code;
      throw error;
    }
    return result;
  }

  async connect({ name, slug } = {}) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return withFileLock(join(this.directory, 'connection.lock'), () =>
      this.connectUnlocked({ name, slug }),
    );
  }

  async connectUnlocked({ name, slug } = {}) {
    let state = await this.load();
    if (state && this.needsProtection) await this.save(state);
    if (!state) {
      if (!name || !slug)
        throw new Error('First connection requires --name and --slug');
      const keys = generateKeyPairSync('ed25519');
      state = {
        name,
        slug,
        publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
        privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      };
      // Persist identity before network requests, so partial failure cannot lose the registered key.
      await this.save(state);
    }
    if (
      state.accessToken &&
      Date.parse(state.expiresAt) > Date.now() + 30_000
    ) {
      try {
        return await this.request('/v2/access/me', {
          token: state.accessToken,
        });
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    }
    // A new slug may be chosen after a first-registration collision, but never changes a registered identity.
    if (!state.agent && name && slug) state = { ...state, name, slug };
    const challenge = await this.request('/v2/access/challenge', {
      body: { name: state.name, slug: state.slug, publicKey: state.publicKey },
    });
    const message = JSON.parse(challenge.message);
    if (
      message.protocol !== 'agentwork-connect-v2' ||
      message.audience !== this.url ||
      message.challengeId !== challenge.challengeId ||
      message.fingerprint !==
        createHash('sha256').update(state.publicKey).digest('hex') ||
      message.name !== state.name ||
      message.slug !== state.slug ||
      !Number.isFinite(Date.parse(message.expiresAt)) ||
      Date.parse(message.expiresAt) <= Date.now()
    )
      throw new Error('Untrusted or expired connection challenge');
    const signature = sign(
      null,
      Buffer.from(challenge.message),
      state.privateKey,
    ).toString('base64');
    const connected = await this.request('/v2/access/connect', {
      body: {
        challengeId: challenge.challengeId,
        signature,
        ...(state.registrationAllowed === false ? { register: false } : {}),
      },
    });
    await this.save({ ...state, ...connected });
    return {
      agent: connected.agent,
      installationId: connected.installationId,
      expiresAt: connected.expiresAt,
    };
  }

  async call(path, body, key) {
    await this.connect();
    const state = await this.load();
    return this.request(path, { body, token: state.accessToken, key });
  }

  async projectPages() {
    const items = [];
    const seen = new Set();
    let cursor;
    do {
      const page = await this.call(
        `/v2/projects/page?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      if (!Array.isArray(page.items))
        throw new Error('Invalid project page response');
      items.push(...page.items);
      cursor = page.nextCursor;
      if (cursor) {
        if (seen.has(cursor))
          throw new Error('Project pagination cursor repeated');
        seen.add(cursor);
      }
    } while (cursor);
    return items;
  }

  async disconnect(revoke = false) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return withFileLock(join(this.directory, 'connection.lock'), async () => {
      let state = await this.load();
      if (!state) return { disconnected: true };
      if (revoke) {
        await this.connectUnlocked();
        state = await this.load();
      }
      if (state.accessToken) {
        try {
          await this.request(`/v2/access/${revoke ? 'revoke' : 'disconnect'}`, {
            body: {},
            token: state.accessToken,
          });
        } catch (error) {
          if (revoke || error.status !== 401) throw error;
        }
      }
      delete state.accessToken;
      delete state.expiresAt;
      await this.save(state);
      return { disconnected: true, revoked: revoke };
    });
  }
}
