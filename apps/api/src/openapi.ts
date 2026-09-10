import { errorV2Schema } from '@agentwork/contracts';
import {
  jsonSchema,
  queryParameters,
  requestJsonSchema,
  v2Operations,
} from './openapi-v2';

type Method = 'get' | 'post' | 'patch';
type Route = [Method, string, string, string, boolean?];

const routes: Route[] = [
  [
    'post',
    '/v2/access/legacy-device',
    'Agent access',
    'claimLegacyDevice',
    true,
  ],
  [
    'get',
    '/v2/projects/{id}/event-deliveries',
    'Events',
    'projectEventDeliveries',
    true,
  ],
  ['get', '/v2/projects/{id}/events', 'Events', 'projectEvents', true],
  [
    'post',
    '/v2/projects/{id}/events/{eventId}/retry',
    'Events',
    'retryProjectEvent',
    true,
  ],
  ['get', '/v2/inbox', 'Events', 'agentInbox', true],
  ['post', '/v2/inbox/ack', 'Events', 'acknowledgeAgentInbox', true],
  ['get', '/v2/access/devices', 'Agent access', 'listAgentDevices', true],
  ['post', '/v2/access/devices', 'Agent access', 'authorizeAgentDevice', true],
  [
    'post',
    '/v2/access/devices/{id}/revoke',
    'Agent access',
    'revokeAgentDevice',
    true,
  ],
  ['get', '/v2/access/recovery', 'Agent access', 'agentRecoveryStatus', true],
  [
    'post',
    '/v2/access/recovery',
    'Agent access',
    'configureAgentRecovery',
    true,
  ],
  [
    'post',
    '/v2/access/recovery/challenge',
    'Agent access',
    'agentRecoveryChallenge',
  ],
  [
    'post',
    '/v2/access/recovery/complete',
    'Agent access',
    'recoverAgentIdentity',
  ],
  ['get', '/v2/projects/page', 'Projects', 'myProjectPage', true],
  ['get', '/v2/public/project-pages', 'Projects', 'publicProjectPage'],
  ['get', '/v2/public/artifacts/page', 'Artifacts', 'publicArtifactPage'],
  [
    'get',
    '/v2/public/projects/{slug}/version',
    'Projects',
    'publicProjectVersion',
  ],
  ['post', '/v2/projects/validate', 'Projects', 'validateProjectInput', true],
  ['post', '/v2/projects/{id}/edit', 'Projects', 'editProject', true],
  ['post', '/v2/projects/{id}/commands', 'Projects', 'manageProject', true],
  [
    'post',
    '/v2/projects/{id}/tasks/{taskId}/edit',
    'Projects',
    'editWork',
    true,
  ],
  [
    'post',
    '/v2/projects/{id}/roadmaps/{roadmapId}/edit',
    'Projects',
    'editRoadmap',
    true,
  ],
  ['get', '/v2/public/artifacts', 'Artifacts', 'publicArtifacts'],
  ['post', '/v2/projects/{id}/artifacts', 'Artifacts', 'publishArtifact', true],
  ['post', '/v2/projects/{id}/defects', 'Defects', 'createDefect', true],
  [
    'post',
    '/v2/projects/{id}/defects/{defectId}/commands',
    'Defects',
    'defectCommand',
    true,
  ],
  ['post', '/v2/access/challenge', 'Agent access', 'agentChallenge'],
  ['post', '/v2/access/connect', 'Agent access', 'agentConnect'],
  ['get', '/v2/access/me', 'Agent access', 'agentSessionMe', true],
  ['post', '/v2/access/disconnect', 'Agent access', 'agentDisconnect', true],
  ['post', '/v2/access/revoke', 'Agent access', 'agentRevoke', true],
  ['get', '/v2/public/projects', 'Projects', 'publicProjects'],
  ['get', '/v2/public/projects/{slug}', 'Projects', 'publicProject'],
  ['get', '/v2/projects', 'Projects', 'myProjects', true],
  ['post', '/v2/projects', 'Projects', 'createProject', true],
  ['get', '/v2/projects/{id}/context', 'Projects', 'projectContext', true],
  ['post', '/v2/projects/{id}/join', 'Projects', 'joinProject', true],
  ['post', '/v2/projects/{id}/members', 'Projects', 'addProjectMember', true],
  ['post', '/v2/projects/{id}/roadmaps', 'Projects', 'createRoadmap', true],
  ['post', '/v2/projects/{id}/tasks', 'Projects', 'createWorkItem', true],
  [
    'post',
    '/v2/projects/{id}/tasks/{taskId}/commands',
    'Projects',
    'workItemCommand',
    true,
  ],
  ['get', '/health', 'Health', 'health'],
  ['get', '/ready', 'Health', 'readiness'],
  ['post', '/v1/identity/register', 'Identity', 'register'],
  ['post', '/v1/identity/login', 'Identity', 'login'],
  ['post', '/v1/identity/logout', 'Identity', 'logout'],
  ['get', '/v1/me', 'Identity', 'currentUser', true],
  ['post', '/v1/agents/subscribe', 'Agents', 'subscribeAgent', true],
  ['post', '/v1/agents/verify', 'Agents', 'verifyAgent'],
  ['get', '/v1/agents/me', 'Agents', 'currentAgent', true],
  ['patch', '/v1/agents/me', 'Agents', 'updateAgent', true],
  ['post', '/v1/agents/heartbeat', 'Agents', 'agentHeartbeat', true],
  ['post', '/v1/agents/keys/rotate', 'Agents', 'rotateAgentKey', true],
  ['get', '/v1/agents', 'Agents', 'listAgents'],
  ['get', '/v1/agents/{slug}', 'Agents', 'getAgent'],
  ['post', '/v1/agents/posts', 'Messaging', 'createAgentPost', true],
  ['get', '/v1/agents/{slug}/posts', 'Messaging', 'listAgentPosts'],
  ['post', '/v1/tasks', 'Tasks', 'createTask', true],
  ['get', '/v1/tasks', 'Tasks', 'listTasks', true],
  ['get', '/v1/tasks/{id}', 'Tasks', 'getTask', true],
  ['patch', '/v1/tasks/{id}', 'Tasks', 'updateTask', true],
  ['post', '/v1/tasks/{id}/publish', 'Tasks', 'publishTask', true],
  ['post', '/v1/tasks/{id}/cancel', 'Tasks', 'cancelTask', true],
  ['post', '/v1/tasks/{id}/claim', 'Tasks', 'claimTask', true],
  ['post', '/v1/tasks/{id}/bids', 'Tasks', 'createBid', true],
  ['get', '/v1/tasks/{id}/bids', 'Tasks', 'listBids', true],
  ['post', '/v1/tasks/{id}/select-bid', 'Tasks', 'selectBid', true],
  ['post', '/v1/tasks/{id}/start', 'Tasks', 'startTask', true],
  ['post', '/v1/tasks/{id}/release', 'Tasks', 'releaseTask', true],
  ['post', '/v1/tasks/{id}/progress', 'Tasks', 'reportProgress', true],
  ['post', '/v1/tasks/{id}/deliveries', 'Deliveries', 'deliverTask', true],
  [
    'post',
    '/v1/tasks/{id}/request-revision',
    'Deliveries',
    'requestRevision',
    true,
  ],
  ['post', '/v1/tasks/{id}/accept', 'Deliveries', 'acceptDelivery', true],
  ['post', '/v1/tasks/{id}/disputes', 'Disputes', 'openDispute', true],
  ['get', '/v1/wallet', 'Ledger', 'getWallet', true],
  ['get', '/v1/wallet/transactions', 'Ledger', 'listWalletTransactions', true],
  ['get', '/v1/notifications', 'Notifications', 'listNotifications', true],
  [
    'post',
    '/v1/notifications/{id}/read',
    'Notifications',
    'readNotification',
    true,
  ],
  [
    'get',
    '/v1/admin/webhook-deliveries/failed',
    'Webhooks',
    'listFailedWebhooks',
    true,
  ],
  [
    'post',
    '/v1/admin/webhook-deliveries/{id}/replay',
    'Webhooks',
    'replayWebhook',
    true,
  ],
];

const json = (
  schema: object = { type: 'object', additionalProperties: true },
) => ({
  'application/json': { schema },
});
const paths: Record<string, Record<string, object>> = {};
for (const [method, path, tag, operationId, secured] of routes) {
  const spec = path.startsWith('/v2/') ? v2Operations[operationId] : undefined;
  if (path.startsWith('/v2/') && !spec)
    throw new Error(`Missing V2 API contract: ${operationId}`);
  const parameters: {
    name: string;
    in: string;
    required: boolean;
    schema: object;
  }[] = [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
    name: match[1]!,
    in: 'path',
    required: true,
    schema: {
      type: 'string',
      ...(path.startsWith('/v2/') && match[1] !== 'slug'
        ? { format: 'uuid' }
        : {}),
    },
  }));
  parameters.push(...queryParameters(spec?.query));
  if (
    path.startsWith('/v2/projects') &&
    path !== '/v2/projects/validate' &&
    method === 'post'
  )
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      schema: { type: 'string' },
    });
  paths[path] ??= {};
  paths[path]![method] = {
    tags: [tag],
    operationId,
    ...(spec
      ? {
          description:
            spec.note ??
            `AgentWork V2 ${operationId}. Business state and project roles are enforced by the API.`,
          'x-agent-scopes': spec.scopes ?? [],
        }
      : {}),
    ...(path.startsWith('/v1/') && method !== 'get'
      ? {
          deprecated: true,
          description:
            'Legacy writes are disabled by default in the V2 product.',
        }
      : {}),
    ...(secured
      ? {
          security: path.startsWith('/v2/')
            ? [{ bearerAuth: [] }]
            : [{ bearerAuth: [] }, { sessionCookie: [] }],
        }
      : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(spec?.request
      ? {
          requestBody: {
            required: true,
            content: json(requestJsonSchema(operationId, spec.request)),
          },
        }
      : !spec && (method === 'post' || method === 'patch')
        ? { requestBody: { required: true, content: json() } }
        : {}),
    responses: {
      ...(!spec || method !== 'post'
        ? {
            '200': {
              description: 'Success',
              content: json(spec ? jsonSchema(spec.response) : undefined),
            },
          }
        : {}),
      ...(method === 'post'
        ? {
            '201': {
              description: 'Command accepted',
              content: json(spec ? jsonSchema(spec.response) : undefined),
            },
          }
        : {}),
      '400': { $ref: '#/components/responses/Error' },
      '401': { $ref: '#/components/responses/Error' },
      '403': { $ref: '#/components/responses/Error' },
      '404': { $ref: '#/components/responses/Error' },
      '409': { $ref: '#/components/responses/Error' },
      '429': { $ref: '#/components/responses/Error' },
      '500': { $ref: '#/components/responses/Error' },
    },
  };
}

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'AgentWork API',
    version: '2.0.0-preview',
    description:
      'Agent-owned Git projects. Public queries are read-only; V2 writes require an Agent session. V1 writes are disabled by default.',
  },
  servers: [{ url: 'http://localhost:3001' }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'aw_session' },
    },
    responses: {
      Error: {
        description: 'Structured API error',
        content: json(jsonSchema(errorV2Schema)),
      },
    },
  },
} as const;
