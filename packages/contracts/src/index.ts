import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  status: z.string(),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof userSchema>;

export const agentCapabilitySchema = z.object({
  capability: z.string(),
  proficiency: z.number().int().min(1).max(5),
  evidence: z.unknown().optional(),
});
export const agentManifestSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().min(1).max(2000),
  webhookUrl: z.string().url(),
  publicKey: z.string().min(40),
  capabilities: z.array(agentCapabilitySchema).min(1).max(50),
  languages: z.array(z.string().min(1)).min(1).max(20),
});
export type AgentManifest = z.infer<typeof agentManifestSchema>;

export const agentSubscriptionSchema = z.object({
  agentId: z.string(),
  challenge: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AgentSubscription = z.infer<typeof agentSubscriptionSchema>;
export const agentCredentialSchema = z.object({
  agentId: z.string(),
  apiKey: z.string().startsWith('awk_'),
});
export type AgentCredential = z.infer<typeof agentCredentialSchema>;

export const agentProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  verificationLevel: z.string(),
  manifestVersion: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  capabilities: z.array(agentCapabilitySchema),
  heartbeats: z.array(
    z.object({
      status: z.string(),
      capacity: z.number(),
      lastSeenAt: z.coerce.date(),
    }),
  ),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export interface AgentHeartbeatInput {
  status: 'ONLINE' | 'BUSY' | 'DEGRADED' | 'OFFLINE';
  capacity: number;
  metadata?: Record<string, unknown>;
}
export const taskStatuses = [
  'DRAFT',
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'DELIVERED',
  'REVISION_REQUESTED',
  'OVERDUE',
  'DISPUTED',
  'COMPLETED_SETTLED',
  'CANCELLED_REFUNDED',
  'EXPIRED_REFUNDED',
  'PARTIALLY_SETTLED',
] as const;
export const taskModes = ['CLAIM', 'BID'] as const;
export const taskVisibilities = ['PUBLIC', 'INVITED', 'PRIVATE'] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export const taskModeSchema = z.enum(taskModes);
export const taskVisibilitySchema = z.enum(taskVisibilities);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskMode = z.infer<typeof taskModeSchema>;
export type TaskVisibility = z.infer<typeof taskVisibilitySchema>;

const jsonSchema = z.unknown();
export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(20_000),
    mode: taskModeSchema,
    visibility: taskVisibilitySchema.default('PUBLIC'),
    budget: z.coerce.bigint().positive(),
    deadline: z.coerce.date().optional(),
    maxRevisions: z.number().int().min(0).max(20).default(2),
    deliverables: jsonSchema,
    constraints: jsonSchema.optional(),
    acceptanceCriteria: jsonSchema,
    capabilities: z.array(z.string().min(1)).max(50).default([]),
  })
  .strict();
export const updateTaskSchema = createTaskSchema
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();
export const versionCommandSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const bidSchema = z
  .object({
    amount: z.coerce.bigint().positive(),
    proposal: z.string().trim().min(1).max(20_000),
    eta: z.coerce.date(),
    version: z.number().int().positive(),
  })
  .strict();
export const selectBidSchema = z
  .object({ bidId: z.string().uuid(), version: z.number().int().positive() })
  .strict();
export const progressSchema = z
  .object({
    message: z.string().trim().min(1).max(20_000),
    percent: z.number().int().min(0).max(100).optional(),
    version: z.number().int().positive(),
  })
  .strict();
export const attachmentSchema = z
  .object({
    objectKey: z.string().min(1).max(1024),
    mimeType: z.string().min(1).max(255),
    size: z.coerce.bigint().nonnegative(),
    checksum: z.string().min(1).max(255),
  })
  .strict();
export const deliverySchema = z
  .object({
    summary: z.string().trim().min(1).max(20_000),
    content: jsonSchema.optional(),
    attachments: z.array(attachmentSchema).max(50).default([]),
    version: z.number().int().positive(),
  })
  .strict();
export const revisionSchema = z
  .object({
    reason: z.string().trim().min(1).max(20_000),
    version: z.number().int().positive(),
  })
  .strict();
export const disputeSchema = z
  .object({
    reason: z.string().trim().min(1).max(20_000),
    version: z.number().int().positive(),
  })
  .strict();
export const taskListQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: taskStatusSchema.optional(),
    mode: taskModeSchema.optional(),
    publisherId: z.string().uuid().optional(),
  })
  .strict();

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;
export type BidInput = z.input<typeof bidSchema>;
export type DeliveryInput = z.input<typeof deliverySchema>;
export type TaskDto = {
  id: string;
  publisherId: string;
  title: string;
  objective: string;
  mode: TaskMode;
  visibility: TaskVisibility;
  budget: string;
  status: TaskStatus;
  version: number;
  deadline: string | null;
  maxRevisions: number;
  createdAt: string;
  updatedAt: string;
};
export type BidDto = {
  id: string;
  taskId: string;
  agentId: string;
  amount: string;
  proposal: string;
  eta: string;
  status: string;
};
export type DeliveryDto = {
  id: string;
  taskId: string;
  agentId: string;
  version: number;
  summary: string;
  content?: unknown;
  submittedAt: string;
};
export type CursorPage<T> = { items: T[]; nextCursor: string | null };
export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
  request_id: string;
};
export const walletOwnerTypeSchema = z.enum(['USER', 'ORGANIZATION', 'AGENT']);
export type WalletOwnerType = z.infer<typeof walletOwnerTypeSchema>;
export const coinAmountSchema = z.coerce.bigint().positive();
export interface SignupGrantPort {
  /** Call only after the Identity/Agents owner has been persisted. */
  grantSignupCoins(
    ownerType: WalletOwnerType,
    ownerId: string,
    fingerprint: string,
    amount?: bigint,
  ): Promise<{ transactionId: string; granted: boolean }>;
}
