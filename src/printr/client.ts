import { config } from '../config.js';
import type {
  CreateTokenRequest,
  CreateTokenResult,
  QuoteRequest,
  QuoteResult,
  TokenInfo,
  Deployment,
} from './types.js';

class PrintrClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor() {
    this.baseUrl = `${config.printrBaseUrl}/v0`;
    this.headers = {
      'Content-Type': 'application/json',
      ...(config.printrApiKey
        ? { Authorization: `Bearer ${config.printrApiKey}` }
        : {}),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    console.log(`[printr] ${method} ${url}`);
    if (body) console.log('[printr] body:', JSON.stringify(body, null, 2));

    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown error');
      console.error(`[printr] ERROR ${res.status}:`, text);
      throw new PrintrApiError(res.status, text);
    }

    const data = await res.json() as T;
    const keys = typeof data === 'object' && data ? Object.keys(data) : [];
    console.log(`[printr] OK — keys: ${keys.join(', ')}`);
    return data;
  }

  async quote(params: QuoteRequest): Promise<QuoteResult> {
    const res = await this.request<{ quote: QuoteResult }>('POST', '/print/quote', params);
    return res.quote;
  }

  async createToken(params: CreateTokenRequest): Promise<CreateTokenResult> {
    return this.request<CreateTokenResult>('POST', '/print', params);
  }

  async getToken(tokenId: string): Promise<TokenInfo> {
    return this.request<TokenInfo>('GET', `/tokens/${tokenId}`);
  }

  async getDeployments(tokenId: string): Promise<Deployment[]> {
    return this.request<Deployment[]>(
      'GET',
      `/tokens/${tokenId}/deployments`,
    );
  }
}

export class PrintrApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`Printr API error ${status}: ${detail}`);
    this.name = 'PrintrApiError';
  }
}

export const printr = new PrintrClient();
