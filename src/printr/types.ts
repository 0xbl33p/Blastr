// ── CAIP identifiers ──

/** CAIP-2 chain ID, e.g. "eip155:8453" */
export type ChainId = string;

/** CAIP-10 address, e.g. "eip155:8453:0x742d..." */
export type Caip10Address = string;

// ── Chain metadata ──

export interface Chain {
  caip2: ChainId;
  name: string;
  shortName: string;
  emoji: string;
  chainId: number | null;
  nativeToken: string;
  decimals: number;
  rpcUrl: string;
  type: 'evm' | 'svm';
}

// ── Initial buy (exactly one field required) ──

export interface InitialBuy {
  spend_usd?: number;
  spend_native?: string;
  supply_percent?: number;
}

// ── External links ──

export interface ExternalLinks {
  website?: string;
  x?: string;
  telegram?: string;
  github?: string;
}

// ── Launch mode / advanced token params ──

export type FeeSink = 'dev' | 'stake_pool' | 'buyback';
export type MaxTelecoinSupply = '100_million' | '1_billion' | '10_billion';

export interface CustomFees {
  /** 0-150 bps (0-1.5%). Creator fee while trading on bonding curve. */
  bonding_curve_dev_fee_bps?: number;
  /** 0-80 bps (0-0.8%). Creator fee after graduation to AMM. */
  amm_dev_fee_bps?: number;
}

// ── Quote ──

export interface QuoteRequest {
  chains: ChainId[];
  initial_buy: InitialBuy;
  graduation_threshold_per_chain_usd?: number;
  custom_fees?: CustomFees;
  fee_sink?: FeeSink;
  /** 6000-8500 bps. Supply sold on curve vs deposited to AMM at graduation. */
  telecoin_supply_on_curve_ratio_bps?: number;
  max_telecoin_supply?: MaxTelecoinSupply;
}

export interface Cost {
  asset_id: string;
  cost_usd: number;
  cost_asset_atomic: string;
  description?: string;
  limit?: number;
}

export interface Asset {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  price_usd: number;
}

export interface QuoteResult {
  id: string;
  router: string;
  assets: Asset[];
  initial_buy_amount?: string;
  costs: Cost[];
  total: Cost;
}

// ── Create token ──

export interface CreateTokenRequest {
  creator_accounts: Caip10Address[];
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  chains: ChainId[];
  initial_buy: InitialBuy;
  graduation_threshold_per_chain_usd?: number;
  external_links?: ExternalLinks;
  custom_fees?: CustomFees;
  fee_sink?: FeeSink;
  telecoin_supply_on_curve_ratio_bps?: number;
  max_telecoin_supply?: MaxTelecoinSupply;
}

export interface EvmPayload {
  calldata: string;
  hash: string;
  to: string;
  value: string;
  chain_id: string;
}

export interface CreateTokenResult {
  token_id: string;
  payload: Record<string, unknown>;
  quote: QuoteResult;
}

// ── Token info ──

export interface TokenInfo {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  chains: ChainId[];
  status: string;
}

// ── Deployment ──

export interface Deployment {
  chain: ChainId;
  status: 'pending' | 'confirming' | 'live' | 'failed';
  tx_hash?: string;
  contract_address?: string;
  error?: string;
}

