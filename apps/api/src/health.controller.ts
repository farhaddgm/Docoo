import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { HealthResponse, ReadinessResponse } from '@docoo/contracts';

import { HealthService } from './health.service.js';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @HttpCode(200)
  @ApiOperation({ summary: 'Process liveness probe' })
  @ApiResponse({ status: 200, description: 'The API process is alive.' })
  liveness(): HealthResponse {
    return {
      status: 'ok',
      service: 'docoo-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness probe' })
  @ApiResponse({ status: 200, description: 'The API and critical dependencies are ready.' })
  @ApiResponse({ status: 503, description: 'A critical dependency is unavailable.' })
  async readiness(): Promise<ReadinessResponse> {
    const database = await this.healthService.checkDatabase();
    const response: ReadinessResponse = {
      status: database.status === 'up' ? 'ready' : 'not_ready',
      checks: { database },
      timestamp: new Date().toISOString(),
    };

    if (response.status === 'not_ready') {
      throw new ServiceUnavailableException(response);
    }

    return response;
  }
}
