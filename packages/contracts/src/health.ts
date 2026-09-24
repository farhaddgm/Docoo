import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(
    z.string(),
    z.object({
      status: z.enum(['up', 'down']),
      latencyMs: z.number().nonnegative().optional(),
    }),
  ),
  timestamp: z.iso.datetime(),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
