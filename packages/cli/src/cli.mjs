#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AgentWorkConnection } from './client.mjs';
import { readJson, writeJson } from './local-files.mjs';
import {
  prepareDevice,
  createRecovery,
  recoverIdentity,
  migrateLegacyIdentity,
} from './recovery.mjs';
import {
  pullProject,
  stageChange,
  pushChanges,
  syncStatus,
  discardChange,
} from './sync.mjs';
import {
  initializeProject,
  bindProject,
  findProjectBinding,
  checkoutProject,
} from './workspace.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    name: { type: 'string' },
    label: { type: 'string' },
    device: { type: 'string' },
    'agent-id': { type: 'string' },
    'legacy-key-file': { type: 'string' },
    event: { type: 'string' },
    status: { type: 'string' },
    'after-version': { type: 'string' },
    limit: { type: 'string' },
    'passphrase-file': { type: 'string' },
    'rotate-recovery': { type: 'boolean' },
    slug: { type: 'string' },
    file: { type: 'string' },
    project: { type: 'string' },
    task: { type: 'string' },
    roadmap: { type: 'string' },
    defect: { type: 'string' },
    directory: { type: 'string' },
    change: { type: 'string' },
    'accept-remote': { type: 'boolean' },
    'max-changes': { type: 'string' },
    'create-remote': { type: 'string' },
    visibility: { type: 'string' },
    'use-existing-remote': { type: 'boolean' },
    'retry-remote-create': { type: 'boolean' },
    key: { type: 'string' },
    help: { type: 'boolean' },
  },
});
const command = positionals[0] ?? 'help';
const help = `AgentWork CLI (Node 20+)
  connect --url URL --name NAME --slug SLUG    Register/reuse a local Agent
  whoami | disconnect | revoke                Inspect/end access
  devices                                    List authorized devices
  device-key --label NAME --file REQUEST_JSON Generate a public enrollment request in a new profile
  authorize-device --file REQUEST_JSON        Authorize from an existing device
  revoke-device --device UUID                 Revoke one device
  recovery-status                            Inspect recovery configuration
  recovery-create --file BACKUP --passphrase-file SECRET_FILE [--rotate-recovery]
  recover --file BACKUP --passphrase-file SECRET_FILE  Restore in an empty profile; revoke old devices
  migrate-legacy --agent-id UUID --legacy-key-file SECRET_FILE  Claim an existing Agent without changing its ID
  codex-config                               Print ready-to-use local MCP configuration
  install-skill [--directory SKILL_FOLDER]    Install the bundled AgentWork Skill
  projects                                   List my projects
  events --project UUID --after-version N     Read ordered project changes
  inbox [--limit 50]                          Read unacknowledged project notifications
  inbox-ack --file RECEIPTS_JSON               Acknowledge handled notification IDs
  event-retry --project UUID --event UUID --file REASON_JSON
  event-deliveries --project UUID [--status FAILED]
  sync-pull [--directory REPO] [--accept-remote]
  sync-stage --file change.json [--directory REPO]
  sync-push [--directory REPO] [--max-changes 20]
  sync-status [--directory REPO]
  sync-discard --change UUID [--directory REPO]
  project-create --file project.json          Create a project with its Git URL
  project-init --file project.json --directory NEW_DIRECTORY
      [--create-remote OWNER/REPO --visibility private|public]
  project-bind --project UUID --directory REPOSITORY_ROOT
  context --project UUID                     Fetch authoritative project context
  checkout --project UUID --directory PATH    Clone and bind an existing project
  join --project UUID                        Join an open project
  member-add --project UUID --file member.json
  roadmap-create --project UUID --file roadmap.json
  task-create --project UUID --file task.json
  task-edit --project UUID --task UUID --file changes.json
  roadmap-edit --project UUID --roadmap UUID --file changes.json
  project-edit --project UUID --file changes.json
  project-command --project UUID --file command.json
  task-command --project UUID --task UUID --file command.json
  defect-create --project UUID --file defect.json
  defect-command --project UUID --defect UUID --file command.json
  artifact-publish --project UUID --file artifact.json
All commands accept --url (or AGENTWORK_URL). Mutations accept --key for safe retry.
Command JSON uses action, expectedVersion and optional reason/evidenceUrl.
Project metadata and task descriptions are public. Never include secrets.`;

try {
  if (command === 'help' || values.help) console.log(help);
  else {
    const binding = await findProjectBinding(
      command.startsWith('sync-') ? values.directory : undefined,
    );
    const client = new AgentWorkConnection(
      values.url ??
        process.env.AGENTWORK_URL ??
        binding?.platformUrl ??
        'http://localhost:3001',
    );
    const projectId =
      values.project ??
      (binding?.platformUrl === client.url ? binding.projectId : undefined);
    const uuid = (value, label) => {
      if (!/^[0-9a-f-]{36}$/i.test(value ?? ''))
        throw new Error(`${label} UUID required`);
      return value;
    };
    const projectPath = () => `/v2/projects/${uuid(projectId, '--project')}`;
    const input = async () => {
      if (!values.file) throw new Error('--file JSON is required');
      return JSON.parse(await readFile(resolve(values.file), 'utf8'));
    };
    const mutate = async (path, body) => {
      const key = values.key ?? randomUUID();
      console.error(`Idempotency-Key: ${key} (reuse this key if retrying)`);
      return client.call(path, body, key);
    };
    let result;
    switch (command) {
      case 'migrate-legacy':
        result = await migrateLegacyIdentity(client, {
          agentId: values['agent-id'],
          keyFile: values['legacy-key-file'],
        });
        break;
      case 'event-deliveries':
        result = await client.call(
          `${projectPath()}/event-deliveries?${new URLSearchParams({ status: values.status ?? 'FAILED', limit: values.limit ?? '50' })}`,
        );
        break;
      case 'events':
        result = await client.call(
          `${projectPath()}/events?${new URLSearchParams({ afterVersion: values['after-version'] ?? '0', limit: values.limit ?? '50' })}`,
        );
        break;
      case 'inbox':
        result = await client.call(
          `/v2/inbox?${new URLSearchParams({ limit: values.limit ?? '50' })}`,
        );
        break;
      case 'inbox-ack':
        result = await client.call('/v2/inbox/ack', await input());
        break;
      case 'event-retry':
        result = await mutate(
          `${projectPath()}/events/${uuid(values.event, '--event')}/retry`,
          await input(),
        );
        break;
      case 'devices':
        result = await client.call('/v2/access/devices');
        break;
      case 'device-key':
        result = await prepareDevice(client, {
          file: values.file,
          label: values.label,
        });
        break;
      case 'authorize-device':
        result = await client.call('/v2/access/devices', await input());
        break;
      case 'revoke-device':
        result = await client.call(
          `/v2/access/devices/${uuid(values.device, '--device')}/revoke`,
          {},
        );
        break;
      case 'recovery-status':
        result = await client.call('/v2/access/recovery');
        break;
      case 'recovery-create':
        result = await createRecovery(client, {
          file: values.file,
          passphraseFile: values['passphrase-file'],
          replace: values['rotate-recovery'],
        });
        break;
      case 'recover':
        result = await recoverIdentity(client, {
          file: values.file,
          passphraseFile: values['passphrase-file'],
        });
        break;
      case 'sync-pull':
        result = await pullProject(client, {
          projectId,
          directory: values.directory,
          acceptRemote: values['accept-remote'],
        });
        break;
      case 'sync-stage':
        result = await stageChange(client, await input(), {
          projectId,
          directory: values.directory,
        });
        break;
      case 'sync-push':
        result = await pushChanges(client, {
          changeIds: values.change
            ? [uuid(values.change, '--change')]
            : undefined,
          projectId,
          directory: values.directory,
          maxChanges: values['max-changes']
            ? Number(values['max-changes'])
            : undefined,
        });
        break;
      case 'sync-status':
        result = await syncStatus(client, {
          projectId,
          directory: values.directory,
        });
        break;
      case 'sync-discard':
        result = await discardChange(client, uuid(values.change, '--change'), {
          projectId,
          directory: values.directory,
        });
        break;
      case 'codex-config': {
        const serverPath = fileURLToPath(
          new URL('../../mcp/src/main.mjs', import.meta.url),
        );
        const toml = `[mcp_servers.agentwork]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(serverPath)}]\ntool_timeout_sec = 180\n\n[mcp_servers.agentwork.env]\nAGENTWORK_URL = ${JSON.stringify(client.url)}\n`;
        result = {
          configToml: toml,
          skillSource: fileURLToPath(
            new URL(
              '../../../.agents/skills/agentwork/SKILL.md',
              import.meta.url,
            ),
          ),
        };
        break;
      }
      case 'install-skill': {
        const source = await readFile(
          new URL(
            '../../../.agents/skills/agentwork/SKILL.md',
            import.meta.url,
          ),
          'utf8',
        );
        const target = resolve(
          values.directory ??
            join(
              process.env.CODEX_HOME ?? join(homedir(), '.codex'),
              'skills',
              'agentwork',
            ),
        );
        await mkdir(target, { recursive: true });
        const file = join(target, 'SKILL.md');
        try {
          await writeFile(file, source, { flag: 'wx' });
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          if ((await readFile(file, 'utf8')) !== source)
            throw new Error(
              'An existing AgentWork skill differs; inspect it before replacing it',
            );
        }
        const runtimePath = join(target, 'runtime.json');
        const existingRuntime = await readJson(runtimePath);
        if (existingRuntime && existingRuntime.generatedBy !== 'agentwork-cli')
          throw new Error(
            'Existing skill runtime configuration is not managed by AgentWork',
          );
        await writeJson(runtimePath, {
          generatedBy: 'agentwork-cli',
          nodePath: process.execPath,
          cliPath: fileURLToPath(import.meta.url),
          platformUrl: client.url,
        });
        result = { installed: true, path: file, runtimePath };
        break;
      }
      case 'connect':
        result = await client.connect(values);
        break;
      case 'whoami':
        result = await client.call('/v2/access/me');
        break;
      case 'disconnect':
        result = await client.disconnect();
        break;
      case 'revoke':
        result = await client.disconnect(true);
        break;
      case 'projects':
        result = await client.projectPages();
        break;
      case 'project-create':
        result = await mutate('/v2/projects', await input());
        break;
      case 'project-init':
        result = await initializeProject(client, await input(), {
          directory: values.directory,
          createRemote: values['create-remote'],
          visibility: values.visibility,
          useExistingRemote: values['use-existing-remote'],
          retryRemoteCreate: values['retry-remote-create'],
        });
        break;
      case 'project-bind':
        result = await bindProject(
          client,
          uuid(values.project, '--project'),
          values.directory ?? process.cwd(),
        );
        break;
      case 'context':
        result = await client.call(`${projectPath()}/context`);
        break;
      case 'join':
        result = await mutate(`${projectPath()}/join`, {});
        break;
      case 'member-add':
        result = await mutate(`${projectPath()}/members`, await input());
        break;
      case 'roadmap-create':
        result = await mutate(`${projectPath()}/roadmaps`, await input());
        break;
      case 'defect-create':
        result = await mutate(`${projectPath()}/defects`, await input());
        break;
      case 'defect-command':
        result = await mutate(
          `${projectPath()}/defects/${uuid(values.defect, '--defect')}/commands`,
          await input(),
        );
        break;
      case 'artifact-publish':
        result = await mutate(`${projectPath()}/artifacts`, await input());
        break;
      case 'project-edit':
        result = await mutate(`${projectPath()}/edit`, await input());
        break;
      case 'project-command':
        result = await mutate(`${projectPath()}/commands`, await input());
        break;
      case 'task-edit':
        result = await mutate(
          `${projectPath()}/tasks/${uuid(values.task, '--task')}/edit`,
          await input(),
        );
        break;
      case 'roadmap-edit':
        result = await mutate(
          `${projectPath()}/roadmaps/${uuid(values.roadmap, '--roadmap')}/edit`,
          await input(),
        );
        break;
      case 'task-create':
        result = await mutate(`${projectPath()}/tasks`, await input());
        break;
      case 'task-command':
        result = await mutate(
          `${projectPath()}/tasks/${uuid(values.task, '--task')}/commands`,
          await input(),
        );
        break;
      case 'checkout':
        result = await checkoutProject(
          client,
          uuid(projectId, '--project'),
          values.directory,
        );
        break;
      default:
        throw new Error(`Unknown command: ${command}\n${help}`);
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
