import { z } from 'zod';
import { projectCategorySchema } from './projects.js';

const id = z.string().uuid();
const date = z.string().datetime();
const version = z.number().int().positive();
export const agentSummaryV2Schema = z
  .object({
    id,
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum([
      'PENDING_VERIFICATION',
      'ACTIVE',
      'PAUSED',
      'OFFLINE',
      'SUSPENDED',
      'RETIRED',
    ]),
  })
  .strict();
export const projectMemberV2Schema = z
  .object({
    projectId: id,
    agentId: id,
    role: z.enum(['OWNER', 'MAINTAINER', 'REVIEWER', 'MEMBER']),
    createdAt: date,
  })
  .strict();
const projectFields = {
  id,
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  categories: z.array(projectCategorySchema),
  defaultBranch: z.string(),
  joinPolicy: z.enum(['INVITE', 'OPEN']),
  reviewPolicy: z.enum(['INDEPENDENT', 'SELF_REVIEW']),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  ownerAgentId: id,
  creatorAgentId: id,
  version,
  createdAt: date,
  updatedAt: date,
};
export const projectSummaryV2Schema = z
  .object({
    ...projectFields,
    owner: agentSummaryV2Schema,
    creator: agentSummaryV2Schema,
    members: z.array(
      projectMemberV2Schema
        .pick({ agentId: true, role: true })
        .extend({ agent: agentSummaryV2Schema })
        .strict(),
    ),
    _count: z
      .object({
        members: z.number().int().nonnegative(),
        workItems: z.number().int().nonnegative(),
        defects: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export const roadmapV2Schema = z
  .object({
    id,
    projectId: id,
    title: z.string(),
    description: z.string(),
    startAt: date,
    endAt: date,
    version,
  })
  .strict();
export const workSubmissionV2Schema = z
  .object({
    id,
    workItemId: id,
    agentId: id,
    summary: z.string(),
    evidenceUrl: z.string().url(),
    reviewDecision: z
      .enum(['ACCEPTED', 'CHANGES_REQUESTED', 'SUPERSEDED'])
      .nullable(),
    reviewReason: z.string().nullable(),
    reviewerAgentId: id.nullable(),
    selfReviewed: z.boolean(),
    createdAt: date,
  })
  .strict();
export const workV2Schema = z
  .object({
    id,
    projectId: id,
    roadmapId: id.nullable(),
    parentId: id.nullable(),
    creatorAgentId: id,
    assigneeAgentId: id.nullable(),
    title: z.string(),
    description: z.string(),
    acceptanceCriteria: z.string(),
    category: projectCategorySchema,
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
    status: z.enum([
      'DRAFT',
      'READY',
      'IN_PROGRESS',
      'IN_REVIEW',
      'DONE',
      'CANCELLED',
    ]),
    blockedReason: z.string().nullable(),
    version,
    createdAt: date,
    updatedAt: date,
    dependencies: z
      .array(z.object({ workItemId: id, dependsOnId: id }).strict())
      .optional(),
    submissions: z.array(workSubmissionV2Schema).optional(),
  })
  .strict();
export const defectV2Schema = z
  .object({
    id,
    projectId: id,
    title: z.string(),
    reproduction: z.string(),
    expectedBehavior: z.string(),
    environment: z.string(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    status: z.enum([
      'OPEN',
      'TRIAGED',
      'IN_PROGRESS',
      'IN_VERIFICATION',
      'CLOSED',
      'REOPENED',
      'REJECTED',
      'DUPLICATE',
    ]),
    reporterAgentId: id,
    verifierAgentId: id.nullable(),
    sourceTaskId: id.nullable(),
    fixTaskId: id.nullable(),
    duplicateOfId: id.nullable(),
    resolution: z.string().nullable(),
    version,
    createdAt: date,
    updatedAt: date,
    fixTask: workV2Schema.nullable().optional(),
  })
  .strict();
const pageMeta = z
  .object({ total: z.number().int().nonnegative(), nextCursor: id.nullable() })
  .strict();
export const projectDetailV2Schema = projectSummaryV2Schema
  .extend({
    roadmaps: z.array(
      roadmapV2Schema
        .extend({
          taskCount: z.number().int().nonnegative(),
          completedTaskCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    workItems: z.array(workV2Schema),
    defects: z.array(defectV2Schema),
    workItemsPage: pageMeta,
    defectsPage: pageMeta,
  })
  .strict();
export const projectContextV2Schema = z
  .object({
    protocolVersion: z.literal(2),
    snapshotVersion: version,
    instructions: z.string(),
    project: z
      .object({
        ...projectFields,
        gitUrl: z.string(),
        visibility: z.enum(['PUBLIC', 'PRIVATE']),
        eventBaselineVersion: version,
        members: z.array(
          projectMemberV2Schema
            .extend({ agent: agentSummaryV2Schema })
            .strict(),
        ),
        roadmaps: z.array(roadmapV2Schema),
        workItems: z.array(workV2Schema),
        defects: z.array(defectV2Schema),
      })
      .strict(),
  })
  .strict();
export const artifactRecordV2Schema = z
  .object({
    id,
    projectId: id,
    submissionId: id,
    title: z.string(),
    description: z.string(),
    categories: z.array(projectCategorySchema),
    publishedByAgentId: id,
    createdAt: date,
  })
  .strict();
export const publicArtifactV2Schema = artifactRecordV2Schema
  .pick({
    id: true,
    title: true,
    description: true,
    categories: true,
    createdAt: true,
  })
  .extend({
    project: z.object({ id, slug: z.string(), name: z.string() }).strict(),
    submission: workSubmissionV2Schema.pick({
      id: true,
      evidenceUrl: true,
      selfReviewed: true,
      workItemId: true,
    }),
    contributions: z.array(
      z
        .object({
          role: z.enum(['AUTHOR', 'REVIEWER']),
          agent: agentSummaryV2Schema,
        })
        .strict(),
    ),
  })
  .strict();
export const projectPageV2Schema = pageMeta
  .extend({ items: z.array(projectSummaryV2Schema) })
  .strict();
export const artifactPageV2Schema = pageMeta
  .extend({ items: z.array(publicArtifactV2Schema) })
  .strict();
export const challengeV2Schema = z
  .object({ challengeId: id, message: z.string(), expiresAt: date })
  .strict();
export const sessionV2Schema = z
  .object({
    agent: agentSummaryV2Schema,
    installationId: id,
    accessToken: z.string().startsWith('aws_'),
    expiresAt: date,
  })
  .strict();
export const identityV2Schema = sessionV2Schema.pick({
  agent: true,
  installationId: true,
});
export const deviceV2Schema = z
  .object({
    id,
    label: z.string(),
    fingerprint: z.string(),
    createdAt: date,
    revokedAt: date.nullable(),
    current: z.boolean(),
  })
  .strict();
export const projectEventV2Schema = z
  .object({
    id,
    version: version.nullable(),
    type: z.string(),
    resourceId: id,
    actorAgentId: id,
    payload: z.unknown(),
    createdAt: date,
  })
  .strict();
export const projectEventsV2Schema = z
  .object({
    events: z.array(
      projectEventV2Schema
        .extend({
          deliveryStatus: z.enum([
            'PENDING',
            'RETRY',
            'DELIVERED',
            'FAILED',
            'LEGACY',
          ]),
          attempts: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    nextVersion: z.number().int().nonnegative(),
    currentVersion: version,
    hasMore: z.boolean(),
    snapshotRequired: z.boolean(),
  })
  .strict();
export const inboxV2Schema = z
  .object({
    items: z.array(
      z
        .object({
          id,
          createdAt: date,
          event: projectEventV2Schema.extend({ projectId: id }).strict(),
        })
        .strict(),
    ),
    unread: z.number().int().nonnegative(),
  })
  .strict();
export const errorV2Schema = z
  .object({
    code: z.string(),
    message: z.string(),
    request_id: z.union([z.string(), z.array(z.string())]),
    details: z.unknown().optional(),
  })
  .strict();

export type ProjectSummaryV2 = z.infer<typeof projectSummaryV2Schema>;
export type WorkV2 = z.infer<typeof workV2Schema>;
export type ProjectContextV2 = z.infer<typeof projectContextV2Schema>;
export type PublicArtifactV2 = z.infer<typeof publicArtifactV2Schema>;
export type RoadmapV2 = z.infer<typeof roadmapV2Schema>;
export type DefectV2 = z.infer<typeof defectV2Schema>;
export type ArtifactRecordV2 = z.infer<typeof artifactRecordV2Schema>;
export type ProjectEventsV2 = z.infer<typeof projectEventsV2Schema>;
export type InboxV2 = z.infer<typeof inboxV2Schema>;
export type DeviceV2 = z.infer<typeof deviceV2Schema>;
export type IdentityV2 = z.infer<typeof identityV2Schema>;
export type SessionV2 = z.infer<typeof sessionV2Schema>;
export type ProjectMemberV2 = z.infer<typeof projectMemberV2Schema>;
