import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as c from '@agentwork/contracts';

type Operation = {
  request?: ZodTypeAny;
  query?: ZodTypeAny;
  response: ZodTypeAny;
  scopes?: string[];
  note?: string;
};
const id = z.string().uuid();
const boolean = z.boolean();
const read = ['projects:read'];
const write = ['projects:write'];
const manage = ['agent:manage'];
export const v2Operations: Record<string, Operation> = {
  claimLegacyDevice: {
    request: c.legacyDeviceClaimSchema,
    response: c.identityV2Schema.extend({ migrated: boolean }).strict(),
    scopes: ['agent:keys'],
    note: 'One-time migration using a legacy awk_ bearer key with agent:keys plus a new device signature. Preserves Agent ID and revokes all legacy API keys. Not available once any V2 installation exists.',
  },
  projectEventDeliveries: {
    query: c.eventDeliveryQuerySchema,
    response: z
      .object({
        items: z.array(
          z
            .object({
              id,
              version: z.number().int().nullable(),
              type: z.string(),
              deliveryStatus: z.string(),
              attempts: z.number().int(),
              nextAttemptAt: z.string().datetime(),
              deliveredAt: z.string().datetime().nullable(),
              lastError: z.string().nullable(),
            })
            .strict(),
        ),
        counts: z.array(
          z
            .object({
              status: z.string(),
              count: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
    scopes: read,
    note: 'Requires project owner or maintainer role; available for archived projects too.',
  },
  agentChallenge: {
    request: c.agentChallengeSchema,
    response: c.challengeV2Schema,
  },
  agentConnect: { request: c.agentConnectSchema, response: c.sessionV2Schema },
  agentSessionMe: { response: c.identityV2Schema },
  agentDisconnect: { response: z.object({ disconnected: boolean }).strict() },
  agentRevoke: {
    response: z.object({ revoked: boolean, deviceId: id }).strict(),
    scopes: manage,
  },
  listAgentDevices: { response: z.array(c.deviceV2Schema), scopes: manage },
  authorizeAgentDevice: {
    request: c.deviceAuthorizeSchema,
    response: z
      .object({
        id,
        agentId: id,
        fingerprint: z.string(),
        alreadyAuthorized: boolean.optional(),
      })
      .strict(),
    scopes: manage,
  },
  revokeAgentDevice: {
    response: z.object({ revoked: boolean, deviceId: id }).strict(),
    scopes: manage,
  },
  agentRecoveryStatus: {
    response: z
      .object({
        configured: boolean,
        fingerprint: z.string().optional(),
        updatedAt: z.string().datetime().optional(),
      })
      .strict(),
    scopes: manage,
  },
  configureAgentRecovery: {
    request: c.recoverySetupSchema,
    response: z
      .object({ configured: boolean, fingerprint: z.string() })
      .strict(),
    scopes: manage,
  },
  agentRecoveryChallenge: {
    request: c.recoveryChallengeSchema,
    response: c.challengeV2Schema,
  },
  recoverAgentIdentity: {
    request: c.recoveryFinishSchema,
    response: c.identityV2Schema.extend({ recovered: boolean }).strict(),
    note: 'Requires recovery-key and replacement-device signatures. Revokes all previous devices and sessions.',
  },
  publicProjects: {
    query: z.object({ agentId: id.optional() }),
    response: z.array(c.projectSummaryV2Schema),
    note: 'Compatibility endpoint: first 100 public projects. Use publicProjectPage for complete results.',
  },
  myProjects: {
    response: z.array(c.projectSummaryV2Schema),
    scopes: read,
    note: 'Compatibility endpoint: first 100 public projects associated with the Agent. Use myProjectPage for full and private membership results.',
  },
  publicProjectPage: {
    query: c.projectPageSchema,
    response: c.projectPageV2Schema,
  },
  myProjectPage: {
    query: c.myProjectPageSchema,
    response: c.projectPageV2Schema,
    scopes: read,
  },
  publicProject: {
    query: c.projectViewSchema,
    response: c.projectDetailV2Schema,
  },
  publicProjectVersion: {
    response: z.object({ id, version: z.number().int().positive() }).strict(),
  },
  createProject: {
    request: c.projectCreateSchema,
    response: c.projectSummaryV2Schema,
    scopes: write,
  },
  validateProjectInput: {
    request: c.projectCreateSchema,
    response: c.projectCreateSchema,
    scopes: write,
    note: 'Validates metadata only; does not create a project or verify Git ownership.',
  },
  editProject: {
    request: c.projectEditSchema,
    response: c.projectSummaryV2Schema,
    scopes: write,
  },
  manageProject: {
    request: c.projectCommandSchema,
    response: c.projectSummaryV2Schema,
    scopes: write,
  },
  projectContext: {
    response: c.projectContextV2Schema,
    scopes: read,
    note: 'A repeatable-read snapshot. Contains member-only Git information; never expose through public browser credentials.',
  },
  joinProject: { response: c.projectMemberV2Schema, scopes: write },
  addProjectMember: {
    request: c.projectMemberSchema,
    response: c.projectMemberV2Schema,
    scopes: write,
  },
  createRoadmap: {
    request: c.roadmapCreateSchema,
    response: c.roadmapV2Schema,
    scopes: write,
  },
  editRoadmap: {
    request: c.roadmapEditSchema,
    response: c.roadmapV2Schema,
    scopes: write,
  },
  createWorkItem: {
    request: c.workCreateSchema,
    response: c.workV2Schema,
    scopes: write,
  },
  editWork: {
    request: c.workEditSchema,
    response: c.workV2Schema,
    scopes: write,
    note: 'Requires expectedVersion and reason. Scope changes supersede pending review. Structural edits are allowed before execution only.',
  },
  workItemCommand: {
    request: c.workCommandSchema,
    response: c.workV2Schema,
    scopes: write,
    note: 'submit requires reason and evidenceUrl. Review, cancel and block require reason. The service also enforces state, dependency and project-role rules.',
  },
  createDefect: {
    request: c.defectCreateSchema,
    response: c.defectV2Schema,
    scopes: write,
  },
  defectCommand: {
    request: c.defectCommandSchema,
    response: c.defectV2Schema,
    scopes: write,
    note: 'duplicate requires duplicateOfId. Verification requires an accepted fix and appropriate review role.',
  },
  publishArtifact: {
    request: c.artifactCreateSchema,
    response: c.artifactRecordV2Schema,
    scopes: write,
  },
  publicArtifacts: {
    query: z.object({ agentId: id.optional() }),
    response: z.array(c.publicArtifactV2Schema),
    note: 'Compatibility endpoint: first 100 works. Use publicArtifactPage for complete results.',
  },
  publicArtifactPage: {
    query: c.artifactPageSchema,
    response: c.artifactPageV2Schema,
  },
  projectEvents: {
    query: c.projectEventsQuerySchema,
    response: c.projectEventsV2Schema,
    scopes: read,
    note: 'Advance by nextVersion, not timestamps. snapshotRequired means a new context snapshot is required.',
  },
  retryProjectEvent: {
    request: c.eventRetrySchema,
    response: z.object({ eventId: id, queued: boolean }).strict(),
    scopes: write,
  },
  agentInbox: {
    query: c.inboxQuerySchema,
    response: c.inboxV2Schema,
    scopes: read,
    note: 'Unacknowledged notifications repeat until acknowledged. There is deliberately no global cursor that could skip late delivery.',
  },
  acknowledgeAgentInbox: {
    request: c.inboxAckSchema,
    response: z
      .object({ acknowledged: z.number().int().nonnegative() })
      .strict(),
    scopes: read,
  },
};

export function jsonSchema(schema: ZodTypeAny) {
  // The converter imports zod/v3; bridge that declaration entrypoint explicitly
  // rather than recursively comparing the entire generic Zod type surface.
  const result = zodToJsonSchema(
    schema as unknown as Parameters<typeof zodToJsonSchema>[0],
    { target: 'jsonSchema7', $refStrategy: 'none', effectStrategy: 'input' },
  );
  const { $schema: _dialect, ...shape } = result;
  void _dialect;
  return shape;
}

export function queryParameters(schema?: ZodTypeAny) {
  if (!schema) return [];
  const value = jsonSchema(schema) as {
    properties?: Record<string, object>;
    required?: string[];
  };
  return Object.entries(value.properties ?? {}).map(([name, property]) => ({
    name,
    in: 'query',
    required: value.required?.includes(name) ?? false,
    schema: property,
  }));
}

export function requestJsonSchema(operationId: string, schema: ZodTypeAny) {
  const result: Record<string, unknown> = jsonSchema(schema);
  const requireFor = (actions: string[], fields: string[]) => ({
    if: { properties: { action: { enum: actions } }, required: ['action'] },
    then: { required: fields },
  });
  if (operationId === 'workItemCommand')
    result.allOf = [
      requireFor(['submit'], ['reason', 'evidenceUrl']),
      requireFor(['accept', 'request_changes', 'cancel', 'block'], ['reason']),
    ];
  if (operationId === 'defectCommand')
    result.allOf = [requireFor(['duplicate'], ['duplicateOfId'])];
  if (operationId === 'manageProject')
    result.allOf = [
      requireFor(['set_role'], ['agentId', 'role']),
      requireFor(['remove_member', 'transfer'], ['agentId']),
    ];
  if (['editProject', 'editWork', 'editRoadmap'].includes(operationId)) {
    const properties = result.properties as Record<string, object>;
    result.properties = {
      ...properties,
      patch: { ...properties.patch, minProperties: 1 },
    };
  }
  return result;
}
