import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PlaidItemEntity, SourceConfigEntity } from '../entities/entities';
import { CanonicalServiceUnavailableException } from '../errors/canonical-error';
import {
  ConnectionsListDto,
  ExchangeResponseDto,
  LinkTokenResponseDto,
} from './connections.dto';
import { encryptToken } from './crypto';
import { PLAID_GATEWAY, type PlaidGateway } from './plaid.gateway';
import { safeLog } from './redaction';

/**
 * Connections business logic (P6.1) — parity twin of
 * `backend-python/app/connections/service.py` + `router.py`.
 *
 * Reads/writes the SAME Postgres `plaid_items` + `source_config` tables as the
 * FastAPI backend, encrypts the Plaid access_token at rest (DA-12), and builds
 * the `{items, sources}` Settings snapshot. The Plaid gateway is injected
 * (`PLAID_GATEWAY`) so tests substitute a fake and CI stays hermetic. No
 * token/secret is ever logged (DA-14).
 */

// Canonical source families (Appendix A), in registry order.
const SOURCE_VALUES = [
  'transactions',
  'income',
  'holdings',
  'loans',
  'listings',
] as const;

// Which source families each Plaid product feeds (matches the Python mapping).
const PRODUCT_TO_SOURCES: Record<string, string[]> = {
  transactions: ['transactions'],
  liabilities: ['loans'],
  investments: ['holdings'],
  income: ['income'],
};

const DEFAULT_PRODUCTS = ['transactions', 'liabilities'];

/** Map an Item's products to the sorted, de-duplicated sources it feeds. */
export function sourcesForProducts(products: string[] | null): string[] {
  const out = new Set<string>();
  for (const product of products ?? []) {
    for (const source of PRODUCT_TO_SOURCES[product] ?? []) {
      out.add(source);
    }
  }
  return [...out].sort();
}

/** Parse the comma-separated OAuth redirect allowlist into exact URIs. */
export function parseAllowlist(raw: string): string[] {
  return raw
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
}

/**
 * Return `redirectUri` IFF it EXACTLY matches an allowlisted URI (NO open
 * redirect, DA): a whole-string, case-sensitive match — no prefix/substring
 * logic. Returns null when not allowlisted (the controller renders a 422).
 */
export function resolveRedirect(
  redirectUri: string,
  allowlist: string[],
): string | null {
  return allowlist.includes(redirectUri) ? redirectUri : null;
}

/** Render a datetime to ISO-8601 UTC with a trailing Z, seconds precision. */
function isoZ(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(PLAID_GATEWAY) private readonly gateway: PlaidGateway,
    @Inject(ConfigService) private readonly config: ConfigService,
    @InjectRepository(PlaidItemEntity)
    private readonly items: Repository<PlaidItemEntity>,
    @InjectRepository(SourceConfigEntity)
    private readonly sourceConfig: Repository<SourceConfigEntity>,
  ) {}

  private get encryptionKey(): string {
    return this.config.get<string>('APP_ENCRYPTION_KEY', '');
  }

  private get userId(): string {
    return this.config.get<string>('PLAID_USER_ID', 'local');
  }

  async createLinkToken(products?: string[]): Promise<LinkTokenResponseDto> {
    const requested =
      products && products.length > 0 ? products : DEFAULT_PRODUCTS;
    try {
      const link = await this.gateway.createLinkToken(requested, {
        webhook: this.config.get<string>(
          'PLAID_WEBHOOK_URL',
          'http://localhost:8000/api/v1/connections/webhook',
        ),
        userId: this.userId,
      });
      safeLog('link_token_created', { products: requested });
      return {
        link_token: link.linkToken,
        expiration: isoZ(new Date(link.expiration)),
      };
    } catch {
      safeLog('link_token_error', { products: requested });
      throw new CanonicalServiceUnavailableException('Plaid is unavailable.');
    }
  }

  async exchange(publicToken: string): Promise<ExchangeResponseDto> {
    let accessToken: string;
    let itemId: string;
    try {
      const result = await this.gateway.exchangePublicToken(publicToken);
      accessToken = result.accessToken;
      itemId = result.itemId;
    } catch {
      safeLog('exchange_error', {});
      throw new CanonicalServiceUnavailableException('Plaid is unavailable.');
    }

    const status = await this.storeExchangedItem(itemId, accessToken, {
      products: DEFAULT_PRODUCTS,
    });
    safeLog('item_linked', { item_id: itemId, status });
    return { item_id: itemId, status };
  }

  /** Encrypt + UPSERT a linked Item; the token is stored ONLY as ciphertext. */
  async storeExchangedItem(
    itemId: string,
    accessToken: string,
    opts: { institution?: string | null; products?: string[] | null } = {},
  ): Promise<string> {
    const ciphertext = encryptToken(accessToken, this.encryptionKey);
    const now = new Date();
    try {
      const existing = await this.items.findOne({ where: { itemId } });
      if (existing === null) {
        await this.items.insert({
          userId: this.userId,
          itemId,
          accessToken: ciphertext,
          institution: opts.institution ?? null,
          products: opts.products ?? null,
          status: 'connected',
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await this.items.update(
          { itemId },
          {
            accessToken: ciphertext,
            institution: opts.institution ?? null,
            products: opts.products ?? null,
            status: 'connected',
            updatedAt: now,
          },
        );
      }
    } catch {
      throw new CanonicalServiceUnavailableException();
    }
    return 'connected';
  }

  async list(): Promise<ConnectionsListDto> {
    let items: PlaidItemEntity[];
    let configs: SourceConfigEntity[];
    try {
      items = await this.items.find({ order: { itemId: 'ASC' } });
      configs = await this.sourceConfig.find();
    } catch {
      throw new CanonicalServiceUnavailableException();
    }

    const configBySource = new Map(configs.map((c) => [c.source, c]));
    const connectedSources = new Set<string>();
    const itemDtos = items.map((item) => {
      const itemSources = sourcesForProducts(item.products);
      if (item.status === 'connected') {
        for (const s of itemSources) connectedSources.add(s);
      }
      const dto: ConnectionsListDto['items'][number] = {
        item_id: item.itemId,
        institution: item.institution ?? '',
        products: item.products ?? [],
        status: item.status,
        sources: itemSources,
      };
      // Omit absent optional (DA-6): never emit null/undefined keys.
      if (item.updatedAt) {
        dto.last_synced = isoZ(new Date(item.updatedAt));
      }
      return dto;
    });

    const sources = SOURCE_VALUES.map((source) => ({
      source,
      mode: configBySource.get(source)?.mode ?? 'local',
      status: connectedSources.has(source) ? 'connected' : 'not_connected',
    }));

    return { items: itemDtos, sources };
  }
}
