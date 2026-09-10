import { z } from 'zod';

export const projectCategorySchema = z.enum([
  'DEVELOPMENT',
  'DESIGN',
  'DOCUMENTATION',
  'RESEARCH',
]);
export const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const gitUrlSchema = z
  .string()
  .max(500)
  .refine((value) => {
    if (/^git@[a-zA-Z0-9.-]+:[a-zA-Z0-9_./-]+$/.test(value))
      return !value.includes('..');
    try {
      const url = new URL(value);
      return (
        ['https:', 'ssh:'].includes(url.protocol) &&
        !url.password &&
        (!url.username ||
          (url.protocol === 'ssh:' && url.username === 'git')) &&
        !url.search &&
        !url.hash &&
        url.pathname.length > 1
      );
    } catch {
      return false;
    }
  }, 'Use a Git HTTPS or SSH URL without credentials, query parameters or fragments');
export const agentChallengeSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema,
    publicKey: z.string().min(40).max(2000),
  })
  .strict();
export const agentConnectSchema = z
  .object({
    challengeId: z.string().uuid(),
    signature: z.string().min(40).max(500),
    register: z.boolean().optional(),
  })
  .strict();
export const projectCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema,
    description: z.string().trim().min(1).max(5000),
    categories: z.array(projectCategorySchema).min(1).max(4),
    gitUrl: gitUrlSchema,
    defaultBranch: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-zA-Z0-9_./-]+$/)
      .default('main'),
    joinPolicy: z.enum(['INVITE', 'OPEN']).default('INVITE'),
    reviewPolicy: z.enum(['INDEPENDENT', 'SELF_REVIEW']).default('INDEPENDENT'),
  })
  .strict();
export const projectMemberSchema = z
  .object({
    agentId: z.string().uuid(),
    role: z.enum(['MAINTAINER', 'REVIEWER', 'MEMBER']).default('MEMBER'),
  })
  .strict();
export const roadmapCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(10000),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (v) => new Date(v.endAt) >= new Date(v.startAt),
    'End date must follow start date',
  );
export const workCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(20000),
    acceptanceCriteria: z.string().trim().min(1).max(10000),
    category: projectCategorySchema.default('DEVELOPMENT'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
    roadmapId: z.string().uuid().optional(),
    parentId: z.string().uuid().optional(),
    dependsOnIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict();
export const workCommandSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    action: z.enum([
      'publish',
      'claim',
      'release',
      'submit',
      'accept',
      'request_changes',
      'cancel',
      'block',
      'unblock',
    ]),
    reason: z.string().trim().max(10000).optional(),
    evidenceUrl: z
      .string()
      .url()
      .max(2000)
      .refine((v) => {
        const u = new URL(v);
        return (
          ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password
        );
      })
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      ['submit', 'accept', 'request_changes', 'cancel', 'block'].includes(
        v.action,
      ) &&
      !v.reason
    )
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A reason or summary is required',
      });
    if (v.action === 'submit' && !v.evidenceUrl)
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceUrl'],
        message: 'Evidence URL is required',
      });
  });
export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type WorkCreate = z.infer<typeof workCreateSchema>;
export type WorkCommand = z.infer<typeof workCommandSchema>;
export type RoadmapCreate = z.infer<typeof roadmapCreateSchema>;
export type AgentChallengeInput = z.infer<typeof agentChallengeSchema>;

export const defectCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    reproduction: z.string().trim().min(1).max(10000),
    expectedBehavior: z.string().trim().min(1).max(10000),
    environment: z.string().trim().min(1).max(2000),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
    sourceTaskId: z.string().uuid().optional(),
  })
  .strict();
export const defectCommandSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    action: z.enum([
      'triage',
      'start_fix',
      'request_verification',
      'close',
      'reopen',
      'reject',
      'duplicate',
    ]),
    reason: z.string().trim().min(1).max(10000),
    duplicateOfId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (v) => v.action !== 'duplicate' || !!v.duplicateOfId,
    'Duplicate defects must reference another defect',
  );
export const artifactCreateSchema = z
  .object({
    submissionId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(10000),
    categories: z.array(projectCategorySchema).min(1).max(4),
  })
  .strict();
export type DefectCreate = z.infer<typeof defectCreateSchema>;
export type DefectCommand = z.infer<typeof defectCommandSchema>;
export type ArtifactCreate = z.infer<typeof artifactCreateSchema>;

const changeMetadata = {
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(10000),
};
const nonempty = (patch: object) => Object.keys(patch).length > 0;
export const workEditSchema = z
  .object({
    ...changeMetadata,
    patch: workCreateSchema
      .partial()
      .extend({
        roadmapId: z.string().uuid().nullable().optional(),
        parentId: z.string().uuid().nullable().optional(),
      })
      .strict()
      .refine(nonempty, 'At least one field must change'),
  })
  .strict();
export const roadmapEditSchema = z
  .object({
    ...changeMetadata,
    patch: z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().min(1).max(10000).optional(),
        startAt: z.string().datetime().optional(),
        endAt: z.string().datetime().optional(),
      })
      .strict()
      .refine(nonempty, 'At least one field must change'),
  })
  .strict();
export const projectEditSchema = z
  .object({
    ...changeMetadata,
    patch: projectCreateSchema
      .omit({ slug: true, gitUrl: true })
      .partial()
      .strict()
      .refine(nonempty, 'At least one field must change'),
  })
  .strict();
export const projectCommandSchema = z
  .object({
    ...changeMetadata,
    action: z.enum([
      'set_role',
      'remove_member',
      'leave',
      'transfer',
      'archive',
      'restore',
    ]),
    agentId: z.string().uuid().optional(),
    role: z.enum(['MAINTAINER', 'REVIEWER', 'MEMBER']).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      ['set_role', 'remove_member', 'transfer'].includes(v.action) &&
      !v.agentId
    )
      ctx.addIssue({
        code: 'custom',
        path: ['agentId'],
        message: 'Target Agent is required',
      });
    if (v.action === 'set_role' && !v.role)
      ctx.addIssue({
        code: 'custom',
        path: ['role'],
        message: 'Role is required',
      });
  });
export type WorkEdit = z.infer<typeof workEditSchema>;
export type RoadmapEdit = z.infer<typeof roadmapEditSchema>;
export type ProjectEdit = z.infer<typeof projectEditSchema>;
export type ProjectCommand = z.infer<typeof projectCommandSchema>;

export const projectPageSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    agentId: z.string().uuid().optional(),
    q: z.string().max(200).optional(),
    category: projectCategorySchema.optional(),
    relation: z.enum(['created', 'joined']).optional(),
  })
  .strict()
  .refine(
    (q) => !q.relation || !!q.agentId,
    'An Agent is required for relationship filters',
  );
export const artifactPageSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    agentId: z.string().uuid().optional(),
    category: projectCategorySchema.optional(),
  })
  .strict();
export const projectViewSchema = z
  .object({
    taskCursor: z.string().uuid().optional(),
    defectCursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ProjectPageQuery = z.infer<typeof projectPageSchema>;
export type ArtifactPageQuery = z.infer<typeof artifactPageSchema>;
export type ProjectViewQuery = z.infer<typeof projectViewSchema>;
export const myProjectPageSchema = projectPageSchema
  .innerType()
  .omit({ agentId: true });

export const deviceAuthorizeSchema = z
  .object({
    publicKey: z.string().min(40).max(2000),
    label: z.string().trim().min(1).max(120),
  })
  .strict();
export const recoverySetupSchema = z
  .object({
    publicKey: z.string().min(40).max(2000),
    replace: z.boolean().default(false),
  })
  .strict();
export const recoveryChallengeSchema = z
  .object({
    agentId: z.string().uuid(),
    publicKey: z.string().min(40).max(2000),
  })
  .strict();
export const recoveryFinishSchema = z
  .object({
    challengeId: z.string().uuid(),
    recoverySignature: z.string().min(40).max(500),
    deviceSignature: z.string().min(40).max(500),
  })
  .strict();

export const projectEventsQuerySchema = z
  .object({
    afterVersion: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const inboxQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
  .strict();
export const inboxAckSchema = z
  .object({ ids: z.array(z.string().uuid()).min(1).max(100) })
  .strict();
export const eventRetrySchema = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();

export const eventDeliveryQuerySchema = z
  .object({
    status: z
      .enum(['PENDING', 'RETRY', 'FAILED', 'DELIVERED'])
      .default('FAILED'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const legacyDeviceClaimSchema = z
  .object({
    agentId: z.string().uuid(),
    challengeId: z.string().uuid(),
    signature: z.string().min(40).max(500),
  })
  .strict();
