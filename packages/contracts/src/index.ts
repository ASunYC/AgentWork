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
