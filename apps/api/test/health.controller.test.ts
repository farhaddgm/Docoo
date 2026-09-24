import { describe, expect, it, vi } from 'vitest';

import { HealthController } from '../src/health.controller.js';
import type { HealthService } from '../src/health.service.js';

describe('HealthController', () => {
  it('returns a valid liveness response', () => {
    const healthService = {
      checkDatabase: vi.fn(),
    } as unknown as HealthService;
    const response = new HealthController(healthService).liveness();

    expect(response).toMatchObject({ status: 'ok', service: 'docoo-api', version: '0.1.0' });
    expect(() => new Date(response.timestamp)).not.toThrow();
  });

  it('reports readiness when PostgreSQL responds', async () => {
    const healthService = {
      checkDatabase: vi.fn().mockResolvedValue({ status: 'up', latencyMs: 1 }),
    } as unknown as HealthService;
    const response = await new HealthController(healthService).readiness();

    expect(response.status).toBe('ready');
    expect(response.checks['database']?.status).toBe('up');
  });
});
