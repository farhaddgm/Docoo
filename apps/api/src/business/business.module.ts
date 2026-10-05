import { Module } from '@nestjs/common';
import { masterKeyFromEnv, type MasterKey } from '@docoo/providers';

import { ConfigModule } from '../config/config.module.js';
import { SECRET_MASTER_KEY } from '../providers/providers.service.js';
import { BusinessController } from './business.controller.js';
import { BusinessService } from './business.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [BusinessController],
  providers: [
    BusinessService,
    { provide: SECRET_MASTER_KEY, useFactory: (): MasterKey | null => masterKeyFromEnv() },
  ],
  exports: [BusinessService],
})
export class BusinessModule {}
