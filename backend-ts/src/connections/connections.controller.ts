import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import {
  CanonicalUnauthorizedException,
  CanonicalValidationException,
} from '../errors/canonical-error';
import {
  AcknowledgementDto,
  ConnectionsListDto,
  ExchangeRequestDto,
  ExchangeResponseDto,
  LinkTokenCreateRequestDto,
  LinkTokenResponseDto,
  WebhookRequestDto,
} from './connections.dto';
import {
  ConnectionsService,
  parseAllowlist,
  resolveRedirect,
} from './connections.service';
import { JwksCache, RateLimiter, verifyWebhook } from './webhook';
import { safeLog } from './redaction';
import { PLAID_GATEWAY, type PlaidGateway } from './plaid.gateway';

/**
 * Connections API controller (P6.1) — parity twin of
 * `backend-python/app/connections/router.py`. Same paths, bodies, status codes,
 * and canonical error envelopes as the FastAPI router. The webhook is JWT/JWKS
 * verified (unverified/forged/unsigned -> canonical 401); its body is then
 * schema-validated (-> 422). The OAuth redirect route enforces a strict
 * allowlist (no open redirect) and is excluded from the OpenAPI schema.
 */
@ApiTags('connections')
@Controller('api/v1/connections')
export class ConnectionsController {
  private readonly jwks: JwksCache;
  private readonly limiter = new RateLimiter();

  constructor(
    private readonly service: ConnectionsService,
    @Inject(PLAID_GATEWAY) gateway: PlaidGateway,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    this.jwks = new JwksCache(gateway);
  }

  @Post('link-token')
  @HttpCode(200)
  @ApiOkResponse({ type: LinkTokenResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'Request validation failed.' })
  createLinkToken(
    @Body() body: LinkTokenCreateRequestDto,
  ): Promise<LinkTokenResponseDto> {
    return this.service.createLinkToken(body?.products);
  }

  @Post('exchange')
  @HttpCode(200)
  @ApiOkResponse({ type: ExchangeResponseDto })
  @ApiUnprocessableEntityResponse({ description: 'Request validation failed.' })
  exchange(@Body() body: ExchangeRequestDto): Promise<ExchangeResponseDto> {
    return this.service.exchange(body.public_token);
  }

  @Get()
  @ApiOkResponse({ type: ConnectionsListDto })
  list(): Promise<ConnectionsListDto> {
    return this.service.list();
  }

  @Post('webhook')
  @HttpCode(200)
  @ApiOkResponse({ type: AcknowledgementDto })
  @ApiUnauthorizedResponse({ description: 'Webhook verification failed.' })
  @ApiUnprocessableEntityResponse({ description: 'Request validation failed.' })
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('plaid-verification') verification: string | undefined,
  ): Promise<AcknowledgementDto> {
    if (!this.limiter.allow()) {
      throw new CanonicalUnauthorizedException('Too many webhook attempts.');
    }
    const rawBody: Buffer = req.rawBody ?? Buffer.from('');
    await verifyWebhook(rawBody, verification, this.jwks);

    // Body schema validation AFTER verification (canonical 422 on bad shape).
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8') || '{}');
    } catch {
      throw new CanonicalUnauthorizedException();
    }
    const parsed = this.validateWebhookBody(payload);
    safeLog('webhook_received', {
      webhook_type: parsed.webhook_type,
      webhook_code: parsed.webhook_code,
      item_id: parsed.item_id,
    });
    return { status: 'accepted' };
  }

  @Get('oauth')
  @ApiExcludeEndpoint()
  oauthRedirect(
    @Query('redirect_uri') redirectUri: string,
    @Res() res: Response,
  ): void {
    const allowlist = parseAllowlist(
      this.config.get<string>(
        'OAUTH_REDIRECT_ALLOWLIST',
        'http://localhost:5173/oauth,http://127.0.0.1:5173/oauth',
      ),
    );
    const target = resolveRedirect(redirectUri ?? '', allowlist);
    if (target === null) {
      // Reject a non-allowlisted URI as a validation failure (canonical 422).
      throw new CanonicalValidationException([
        {
          field: 'redirect_uri',
          location: 'query',
          message: 'redirect_uri is not on the allowlist.',
          code: 'value_error',
        },
      ]);
    }
    safeLog('oauth_redirect', {});
    res.redirect(307, target);
  }

  /** Validate the verified webhook body; throw a canonical 422 on bad shape. */
  private validateWebhookBody(payload: unknown): WebhookRequestDto {
    const obj = (payload ?? {}) as Record<string, unknown>;
    const details = [];
    if (typeof obj.webhook_type !== 'string') {
      details.push({
        field: 'webhook_type',
        location: 'body',
        message: 'webhook_type must be a string',
        code: 'isString',
      });
    }
    if (typeof obj.webhook_code !== 'string') {
      details.push({
        field: 'webhook_code',
        location: 'body',
        message: 'webhook_code must be a string',
        code: 'isString',
      });
    }
    if (details.length > 0) {
      throw new CanonicalValidationException(details);
    }
    return {
      webhook_type: obj.webhook_type as string,
      webhook_code: obj.webhook_code as string,
      item_id: typeof obj.item_id === 'string' ? obj.item_id : undefined,
    };
  }
}
