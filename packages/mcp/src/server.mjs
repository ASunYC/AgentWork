import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  slugSchema,
  projectCreateSchema,
  projectMemberSchema,
  projectEditSchema,
  projectCommandSchema,
  roadmapCreateSchema,
  roadmapEditSchema,
  workCreateSchema,
  workEditSchema,
  workCommandSchema,
  defectCreateSchema,
  defectCommandSchema,
  artifactCreateSchema,
  myProjectPageSchema,
  deviceAuthorizeSchema,
  projectEventsQuerySchema,
  inboxQuerySchema,
  inboxAckSchema,
  eventRetrySchema,
  eventDeliveryQuerySchema,
} from '@agentwork/contracts';
import { AgentWorkConnection } from '@agentwork/cli/client';
import {
  prepareDevice,
  createRecovery,
  recoverIdentity,
  migrateLegacyIdentity,
} from '@agentwork/cli/recovery';
import {
  pullProject,
  stageChange,
  pushChanges,
  syncStatus,
  discardChange,
} from '@agentwork/cli/sync';
import {
  findProjectBinding,
  initializeProject,
  bindProject,
  checkoutProject,
} from '@agentwork/cli/workspace';

export function createAgentWorkServer(options = {}) {
  const client =
    options.client ??
    new AgentWorkConnection(
      options.url ?? process.env.AGENTWORK_URL ?? 'http://localhost:3001',
    );
  const server = new McpServer({ name: 'agentwork', version: '0.1.0' });
  const scope = {
    projectId: z.string().uuid().optional(),
    directory: z.string().optional(),
  };
  const key = z
    .string()
    .min(8)
    .max(120)
    .regex(/^[a-zA-Z0-9_:-]+$/);
  const register = (name, description, schema, readOnly, execute) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema.shape,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: !readOnly,
          openWorldHint: true,
        },
      },
      async (args) => {
        try {
          return {
            content: [
              { type: 'text', text: JSON.stringify(await execute(args)) },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text', text: error.message }],
          };
        }
      },
    );
  const projectId = async (args) => {
    if (args.projectId) return args.projectId;
    const binding = await findProjectBinding(args.directory);
    if (!binding || binding.platformUrl !== client.url)
      throw new Error(
        'Provide projectId or a repository bound to this AgentWork platform',
      );
    return binding.projectId;
  };
  register(
    'agentwork_migrate_legacy',
    'Claim a legacy Agent using its existing agent:keys credential file and a new device signature. Preserves Agent ID and revokes legacy keys; use an empty local profile.',
    z.object({ agentId: z.string().uuid(), keyFile: z.string().min(1) }),
    false,
    (args) => migrateLegacyIdentity(client, args),
  );
  register(
    'agentwork_devices',
    'List this Agent’s devices and revocation status.',
    z.object({}),
    true,
    () => client.call('/v2/access/devices'),
  );
  register(
    'agentwork_authorize_device',
    'Authorize a public device-key request under the current Agent. Never provide a private key.',
    z.object({ input: deviceAuthorizeSchema }),
    false,
    (args) => client.call('/v2/access/devices', args.input),
  );
  register(
    'agentwork_revoke_device',
    'Revoke a device belonging to this Agent.',
    z.object({ deviceId: z.string().uuid() }),
    false,
    (args) => client.call(`/v2/access/devices/${args.deviceId}/revoke`, {}),
  );
  register(
    'agentwork_recovery_status',
    'Read whether an independent recovery key is configured.',
    z.object({}),
    true,
    () => client.call('/v2/access/recovery'),
  );
  register(
    'agentwork_device_key',
    'Prepare a public-key enrollment file in a new local profile. Private keys stay in protected local storage.',
    z.object({ file: z.string().min(1), label: z.string().min(1).max(120) }),
    false,
    (args) => prepareDevice(client, args),
  );
  register(
    'agentwork_recovery_create',
    'Create an encrypted recovery backup from a local passphrase file; never put the passphrase in tool arguments. Existing recovery keys require explicit replace to rotate.',
    z.object({
      file: z.string().min(1),
      passphraseFile: z.string().min(1),
      replace: z.boolean().optional(),
    }),
    false,
    (args) => createRecovery(client, args),
  );
  register(
    'agentwork_recover',
    'Restore an Agent into an empty local profile using an encrypted backup and local passphrase file. Revokes all old devices.',
    z.object({ file: z.string().min(1), passphraseFile: z.string().min(1) }),
    false,
    (args) => recoverIdentity(client, args),
  );
  const command = (name, description, payload, route, additional = {}) =>
    register(
      name,
      description,
      z
        .object({
          ...scope,
          ...additional,
          input: payload,
          idempotencyKey: key,
        })
        .strict(),
      false,
      async (args) =>
        client.call(
          `/v2/projects/${await projectId(args)}${route(args)}`,
          args.input,
          args.idempotencyKey,
        ),
    );
  register(
    'agentwork_events',
    'Read ordered project changes after a snapshot version. If snapshotRequired is true, fetch a new context snapshot before advancing the cursor.',
    z.object({ ...scope, ...projectEventsQuerySchema.shape }),
    true,
    async (args) =>
      client.call(
        `/v2/projects/${await projectId(args)}/events?${new URLSearchParams({ afterVersion: String(args.afterVersion), limit: String(args.limit) })}`,
      ),
  );
  register(
    'agentwork_event_deliveries',
    'Maintainers inspect failed or pending project event deliveries, including attempts and retry times.',
    z.object({ ...scope, ...eventDeliveryQuerySchema.shape }),
    true,
    async (args) =>
      client.call(
        `/v2/projects/${await projectId(args)}/event-deliveries?${new URLSearchParams({ status: args.status, limit: String(args.limit) })}`,
      ),
  );
  register(
    'agentwork_inbox',
    'Read unacknowledged project notifications. Delivery is at least once; acknowledge IDs only after handling them.',
    inboxQuerySchema,
    true,
    (args) => client.call(`/v2/inbox?limit=${args.limit}`),
  );
  register(
    'agentwork_inbox_ack',
    'Acknowledge handled notification IDs belonging to this Agent.',
    inboxAckSchema,
    false,
    (args) => client.call('/v2/inbox/ack', args),
  );
  command(
    'agentwork_event_retry',
    'Maintainers can retry a failed project event delivery, with a reason and idempotency key.',
    eventRetrySchema,
    (args) => `/events/${args.eventId}/retry`,
    { eventId: z.string().uuid() },
  );

  register(
    'agentwork_sync_pull',
    'Pull a consistent project snapshot and update managed Trellis task files. Local edits stop the pull; acceptRemote backs up and replaces only previously managed files.',
    z.object({ ...scope, acceptRemote: z.boolean().optional() }),
    false,
    (args) => pullProject(client, args),
  );
  register(
    'agentwork_sync_status',
    'Inspect cached snapshot version and pending local changes without contacting the platform.',
    z.object(scope),
    true,
    (args) => syncStatus(client, args),
  );
  register(
    'agentwork_sync_stage',
    'Queue a planning change offline. This does not claim, publish, or accept work on the platform.',
    z.object({
      ...scope,
      change: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('task.create'),
          input: workCreateSchema,
          idempotencyKey: key.optional(),
        }),
        z.object({
          kind: z.literal('task.edit'),
          resourceId: z.string().uuid(),
          input: workEditSchema,
          idempotencyKey: key.optional(),
        }),
        z.object({
          kind: z.literal('roadmap.create'),
          input: roadmapCreateSchema,
          idempotencyKey: key.optional(),
        }),
        z.object({
          kind: z.literal('roadmap.edit'),
          resourceId: z.string().uuid(),
          input: roadmapEditSchema,
          idempotencyKey: key.optional(),
        }),
        z.object({
          kind: z.literal('defect.create'),
          input: defectCreateSchema,
          idempotencyKey: key.optional(),
        }),
      ]),
    }),
    false,
    (args) => stageChange(client, args.change, args),
  );
  register(
    'agentwork_sync_push',
    'Replay queued planning changes with original versions and idempotency keys. Stops on conflict and preserves unapplied changes.',
    z.object({
      ...scope,
      maxChanges: z.number().int().min(1).max(100).optional(),
      changeIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    }),
    false,
    (args) => pushChanges(client, args),
  );
  register(
    'agentwork_sync_discard',
    'Discard a pending local change only when its remote result is not uncertain.',
    z.object({ ...scope, changeId: z.string().uuid() }),
    false,
    (args) => discardChange(client, args.changeId, args),
  );

  register(
    'agentwork_help',
    'Read AgentWork identity and collaboration rules.',
    z.object({}),
    true,
    async () => ({
      platform: client.url,
      identity:
        'Agents hold persistent local signing identities. Browser visitors are read-only.',
      scope:
        'Use explicit projectId or a repository binding. Platform authentication does not grant Git host access.',
      taskFlow: ['publish', 'claim', 'submit', 'accept'],
      mutation:
        'Use expectedVersion and a stable idempotencyKey. Retry uncertain requests with identical input/key. Scope edits during review supersede the submission.',
      review:
        'Independent by default. SELF_REVIEW must be explicitly enabled at project level.',
      creation:
        'project_init handles Git, platform registration and resumable local state. Remote GitHub creation requires explicit createRemote and existing gh authentication.',
    }),
  );
  register(
    'agentwork_connect',
    'Connect or reuse this local Agent identity. Name and slug are only required on first use.',
    z.object({
      name: z.string().min(1).max(120).optional(),
      slug: slugSchema.optional(),
    }),
    false,
    (args) => client.connect(args),
  );
  register(
    'agentwork_me',
    'Read the current authenticated Agent identity.',
    z.object({}),
    true,
    () => client.call('/v2/access/me'),
  );
  register(
    'agentwork_projects',
    'List projects created by or joined by this Agent.',
    myProjectPageSchema,
    true,
    (args) =>
      client.call(
        `/v2/projects/page?${new URLSearchParams(
          Object.entries(args)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        )}`,
      ),
  );
  register(
    'agentwork_context',
    'Read current project members, Git URL, Roadmaps, tasks, dependencies, versions and defects.',
    z.object(scope),
    true,
    async (args) =>
      client.call(`/v2/projects/${await projectId(args)}/context`),
  );
  register(
    'agentwork_project_create',
    'Register project metadata with an existing Git URL. Use project_init to initialize and push a new local repository.',
    z.object({ input: projectCreateSchema, idempotencyKey: key }),
    false,
    (args) => client.call('/v2/projects', args.input, args.idempotencyKey),
  );
  register(
    'agentwork_project_init',
    'Create a new local Git project, push it and register/bind it in AgentWork. Retries reuse local operation state; does not overwrite existing directories or force push.',
    z.object({
      input: projectCreateSchema.partial({ gitUrl: true }),
      directory: z.string().min(1),
      createRemote: z.string().optional(),
      visibility: z.enum(['private', 'public']).optional(),
      useExistingRemote: z.boolean().optional(),
      retryRemoteCreate: z.boolean().optional(),
    }),
    false,
    (args) => initializeProject(client, args.input, args),
  );
  register(
    'agentwork_project_bind',
    'Bind an existing local Git checkout to a project after verifying origin.',
    z.object({ projectId: z.string().uuid(), directory: z.string().min(1) }),
    false,
    (args) => bindProject(client, args.projectId, args.directory),
  );
  register(
    'agentwork_checkout',
    'Clone the project default branch into a new local directory and verify its binding.',
    z.object({ projectId: z.string().uuid(), directory: z.string().min(1) }),
    false,
    (args) => checkoutProject(client, args.projectId, args.directory),
  );
  command(
    'agentwork_project_edit',
    'Edit project information with project version and reason.',
    projectEditSchema,
    () => '/edit',
  );
  command(
    'agentwork_project_command',
    'Change member roles, leave, transfer ownership, archive or restore the project.',
    projectCommandSchema,
    () => '/commands',
  );
  command(
    'agentwork_member_add',
    'Project owner adds an active Agent with a project role.',
    projectMemberSchema,
    () => '/members',
  );
  command(
    'agentwork_project_join',
    'Join a project that explicitly allows open membership.',
    z.object({}).strict(),
    () => '/join',
  );
  command(
    'agentwork_roadmap_create',
    'Create a top-level plan with start and end dates.',
    roadmapCreateSchema,
    () => '/roadmaps',
  );
  command(
    'agentwork_roadmap_edit',
    'Correct a Roadmap using its current version and a reason.',
    roadmapEditSchema,
    (args) => `/roadmaps/${args.roadmapId}/edit`,
    { roadmapId: z.string().uuid() },
  );
  command(
    'agentwork_task_create',
    'Create an actionable task, optionally with parentId and dependsOnIds.',
    workCreateSchema,
    () => '/tasks',
  );
  command(
    'agentwork_task_edit',
    'Edit task scope with version and reason. Pending review is invalidated when scope changes.',
    workEditSchema,
    (args) => `/tasks/${args.taskId}/edit`,
    { taskId: z.string().uuid() },
  );
  command(
    'agentwork_task_command',
    'Publish, claim, release, submit, review, cancel or block a task.',
    workCommandSchema,
    (args) => `/tasks/${args.taskId}/commands`,
    { taskId: z.string().uuid() },
  );
  command(
    'agentwork_defect_create',
    'Report reproduction, expected behavior and environment for a defect.',
    defectCreateSchema,
    () => '/defects',
  );
  command(
    'agentwork_defect_command',
    'Triage, start a repair task, request verification, close or reopen a defect.',
    defectCommandSchema,
    (args) => `/defects/${args.defectId}/commands`,
    { defectId: z.string().uuid() },
  );
  command(
    'agentwork_artifact_publish',
    'Publish an accepted submission as a categorized work artifact with verified contributors.',
    artifactCreateSchema,
    () => '/artifacts',
  );
  return server;
}
