import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from 'plaid';

/**
 * Thin, injectable wrapper around the Plaid Node client (P6.1).
 *
 * Parity twin of `backend-python/app/connections/plaid_gateway.py`. The service
 * depends on the `PlaidGateway` INTERFACE (DI token `PLAID_GATEWAY`), not the
 * concrete SDK, so tests substitute a fake (CI is hermetic — no network). Only
 * the four calls the connections feature needs are exposed. No token value is
 * ever logged here (DA-14).
 */

export interface LinkToken {
  linkToken: string;
  expiration: string; // ISO-8601 string from Plaid
}

export interface ExchangeResult {
  accessToken: string; // SECRET — encrypted before storage, never returned/logged
  itemId: string;
}

export interface PlaidJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid?: string;
  [key: string]: unknown;
}

export interface PlaidGateway {
  createLinkToken(
    products: string[],
    opts: { webhook: string; userId: string },
  ): Promise<LinkToken>;
  exchangePublicToken(publicToken: string): Promise<ExchangeResult>;
  getWebhookVerificationKey(keyId: string): Promise<PlaidJwk>;
  createSandboxPublicToken(
    institutionId: string,
    initialProducts: string[],
  ): Promise<string>;
}

/** DI token for the gateway (so tests `useValue` a fake). */
export const PLAID_GATEWAY = 'PLAID_GATEWAY';

/** Concrete gateway adapting the official `plaid` Node SDK. */
@Injectable()
export class SdkPlaidGateway implements PlaidGateway {
  private readonly client: PlaidApi;
  private readonly clientId: string;
  private readonly secret: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.clientId = config.get<string>('PLAID_CLIENT_ID', '');
    this.secret = config.get<string>('PLAID_SECRET', '');
    const env = config.get<string>('PLAID_ENV', 'sandbox');
    const basePath =
      env === 'production'
        ? PlaidEnvironments.production
        : PlaidEnvironments.sandbox;
    const configuration = new Configuration({
      basePath,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': this.clientId,
          'PLAID-SECRET': this.secret,
          'Plaid-Version': '2020-09-14',
        },
      },
    });
    this.client = new PlaidApi(configuration);
  }

  async createLinkToken(
    products: string[],
    opts: { webhook: string; userId: string },
  ): Promise<LinkToken> {
    const response = await this.client.linkTokenCreate({
      user: { client_user_id: opts.userId },
      client_name: 'Personal Finance',
      products: products as Products[],
      country_codes: [CountryCode.Us],
      language: 'en',
      webhook: opts.webhook,
    });
    return {
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
    };
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
    const response = await this.client.itemPublicTokenExchange({
      public_token: publicToken,
    });
    return {
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
    };
  }

  async getWebhookVerificationKey(keyId: string): Promise<PlaidJwk> {
    const response = await this.client.webhookVerificationKeyGet({
      key_id: keyId,
    });
    return response.data.key as unknown as PlaidJwk;
  }

  async createSandboxPublicToken(
    institutionId: string,
    initialProducts: string[],
  ): Promise<string> {
    const response = await this.client.sandboxPublicTokenCreate({
      institution_id: institutionId,
      initial_products: initialProducts as Products[],
    });
    return response.data.public_token;
  }
}
