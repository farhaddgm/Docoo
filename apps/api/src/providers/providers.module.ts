import { Module } from '@nestjs/common';
import { ProviderRuntime } from '@docoo/orchestration';
import { masterKeyFromEnv, type MasterKey } from '@docoo/providers';
import type { Pool } from 'pg';

import { ConfigModule } from '../config/config.module.js';
import { DATABASE_POOL } from '../tokens.js';
import { ProvidersController } from './providers.controller.js';
import { CachedPriceCatalogSource, PRICE_CATALOG } from './price-catalog.source.js';
import { PROVIDER_RUNTIME, ProvidersService, SECRET_MASTER_KEY } from './providers.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [ProvidersController],
  providers: [
    ProvidersService,
    { provide: SECRET_MASTER_KEY, useFactory: (): MasterKey | null => masterKeyFromEnv() },
    {
      provide: PRICE_CATALOG,
      useFactory: () => {
        const url = process.env['MODEL_PRICE_CATALOG_URL'];
        return new CachedPriceCatalogSource(url ? { url } : {});
      },
    },
    {
      provide: PROVIDER_RUNTIME,
      inject: [DATABASE_POOL, SECRET_MASTER_KEY],
      useFactory: (pool: Pool, key: MasterKey | null) => new ProviderRuntime(pool, key),
    },
  ],
  exports: [PROVIDER_RUNTIME],
})
export class ProvidersModule {}
