import { Module } from '@nestjs/common';

import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { RetentionService } from './retention.service.js';

@Module({
  controllers: [AuditController],
  providers: [AuditService, RetentionService],
})
export class AuditModule {}
