import 'reflect-metadata';

import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { HttpException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { parseEnvironment } from '@docoo/config';
import { startTelemetry } from '@docoo/observability';

import { AppModule } from './app.module.js';

const localEnv = new URL('../../../.env', import.meta.url);
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const config = parseEnvironment(process.env);
const telemetry = startTelemetry({
  serviceName: config.OTEL_SERVICE_NAME,
  serviceVersion: '0.1.0',
  ...(config.OTEL_EXPORTER_OTLP_ENDPOINT ? { endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
});

const adapter = new FastifyAdapter({
  logger: {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        '*.password',
        '*.token',
        '*.secret',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },
  },
  requestIdHeader: 'x-request-id',
  genReqId: () => randomUUID(),
  // Only enable this for explicitly trusted proxy addresses in a deployment profile.
  trustProxy: false,
});

const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
  bufferLogs: true,
});

await app.register(cookie, { secret: config.SESSION_PEPPER });
await app.register(
  helmet,
  config.NODE_ENV === 'production' ? {} : { contentSecurityPolicy: false },
);
app
  .getHttpAdapter()
  .getInstance()
  .addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    if (routeOptions.url.endsWith('/auth/login') && methods.includes('POST')) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: { max: 10, timeWindow: '1 minute' },
      };
    }
  });
await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
  ban: 3,
  errorResponseBuilder: (_request, context) =>
    new HttpException(
      {
        status: context.statusCode,
        title: context.ban ? 'Forbidden' : 'Too Many Requests',
        code: 'AUTH_RATE_LIMITED',
        detail: 'Please wait before trying again.',
      },
      context.statusCode,
    ),
});

app.enableCors({
  origin: config.WEB_ORIGIN,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
app.enableShutdownHooks();
app.setGlobalPrefix('v1');
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);

if (config.NODE_ENV !== 'production') {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Docoo API')
    .setDescription('Private Docoo control-plane API')
    .setVersion('0.1.0')
    .addCookieAuth('docoo_session')
    .build();
  SwaggerModule.setup('v1/openapi', app, SwaggerModule.createDocument(app, swaggerConfig));
}

await app.listen(config.API_PORT, config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

const shutdownTelemetry = async (): Promise<void> => {
  await telemetry?.shutdown();
};

process.once('SIGTERM', () => void shutdownTelemetry());
process.once('SIGINT', () => void shutdownTelemetry());
