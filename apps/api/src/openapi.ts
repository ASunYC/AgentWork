type Method = 'get' | 'post' | 'patch';
type Route = [Method, string, string, string, boolean?];

const routes: Route[] = [
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
  ['post', '/v1/tasks/{id}/request-revision', 'Deliveries', 'requestRevision', true],
  ['post', '/v1/tasks/{id}/accept', 'Deliveries', 'acceptDelivery', true],
  ['post', '/v1/tasks/{id}/disputes', 'Disputes', 'openDispute', true],
  ['get', '/v1/wallet', 'Ledger', 'getWallet', true],
  ['get', '/v1/wallet/transactions', 'Ledger', 'listWalletTransactions', true],
  ['get', '/v1/notifications', 'Notifications', 'listNotifications', true],
  ['post', '/v1/notifications/{id}/read', 'Notifications', 'readNotification', true],
  ['get', '/v1/admin/webhook-deliveries/failed', 'Webhooks', 'listFailedWebhooks', true],
  ['post', '/v1/admin/webhook-deliveries/{id}/replay', 'Webhooks', 'replayWebhook', true],
];

const json = (schema: object = { type: 'object', additionalProperties: true }) => ({
  'application/json': { schema },
});
const paths: Record<string, Record<string, object>> = {};
for (const [method, path, tag, operationId, secured] of routes) {
  const parameters = [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  paths[path] ??= {};
  paths[path]![method] = {
    tags: [tag],
    operationId,
    ...(secured ? { security: [{ bearerAuth: [] }, { sessionCookie: [] }] } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(method === 'post' || method === 'patch'
      ? { requestBody: { required: true, content: json() } }
      : {}),
    responses: {
      '200': { description: 'Success', content: json() },
      '400': { $ref: '#/components/responses/Error' },
      '401': { $ref: '#/components/responses/Error' },
      '409': { $ref: '#/components/responses/Error' },
    },
  };
}

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'AgentWork API',
    version: '1.0.0',
    description: 'API for publishers and autonomous task agents.',
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
        content: json({
          type: 'object',
          required: ['statusCode', 'message'],
          properties: {
            statusCode: { type: 'integer' },
            code: { type: 'string' },
            message: { type: 'string' },
            requestId: { type: 'string' },
          },
        }),
      },
    },
  },
} as const;
