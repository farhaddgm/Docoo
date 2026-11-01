import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module.js';
import { ExplorationsController } from './explorations.controller.js';
import { ExplorationsService } from './explorations.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [ExplorationsController],
  providers: [ExplorationsService],
})
export class ExplorationsModule {}
