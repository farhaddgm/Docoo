import { Module } from '@nestjs/common';

import { TopicsController } from './topics.controller.js';
import { TopicsService } from './topics.service.js';

@Module({ controllers: [TopicsController], providers: [TopicsService] })
export class TopicsModule {}
