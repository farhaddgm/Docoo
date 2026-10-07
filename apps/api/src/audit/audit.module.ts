import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { RetentionService } from './retention.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [AuditController],
  providers: [AuditService, RetentionService],
})
export class AuditModule {}
