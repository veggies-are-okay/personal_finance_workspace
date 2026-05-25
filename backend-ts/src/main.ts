import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { CanonicalExceptionFilter } from './errors/canonical-exception.filter';
import { canonicalValidationExceptionFactory } from './errors/validation-exception.factory';

/**
 * Application bootstrap.
 *
 * Mirrors the FastAPI app (`backend-python/app/main.py`):
 * - No global route prefix — `/health` is served at the root.
 * - Global `ValidationPipe` with `whitelist` + `transform`.
 * - OpenAPI JSON exposed at `/openapi.json` (same path FastAPI uses) so the
 *   P1.4 parity harness can fetch both backends' schemas.
 * - Listens on `TS_API_PORT` (default 3000).
 */
async function bootstrap(): Promise<void> {
  // `rawBody: true` preserves the unparsed request body so the Plaid webhook can
  // hash it for JWT body-integrity verification (DA-11). The parsed JSON body is
  // still available for the other routes.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Canonical error envelope for EVERY error (DA-1/DA-18): the filter renders
  // the one shared shape, and the ValidationPipe is forced to HTTP 422 with that
  // shape (overriding NestJS's default 400) via the exception factory.
  app.useGlobalFilters(new CanonicalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: canonicalValidationExceptionFactory,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('personal-finance-api')
    .setDescription(
      'NestJS backend (parity twin of the FastAPI backend-python).',
    )
    .setVersion('0.0.1')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Serve the interactive UI at /docs and the raw OpenAPI JSON at /openapi.json
  // (FastAPI serves its schema at the same /openapi.json path).
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'openapi.json',
  });

  const port = process.env.TS_API_PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
