import type { Chain } from './types.js';

export const CHAINS: Chain[] = [
  {
    caip2: 'eip155:8453',
    name: 'Base',
    shortName: 'base',
    emoji: '🔵',
    chainId: 8453,
    nativeToken: 'ETH',
    decimals: 18,
    rpcUrl: 'https://mainnet.base.org',
    type: 'evm',
  },
  {
    caip2: 'eip155:1',
    name: 'Ethereum',
    shortName: 'eth',
    emoji: '💎',
    chainId: 1,
    nativeToken: 'ETH',
    decimals: 18,
    rpcUrl: 'https://cloudflare-eth.com',
    type: 'evm',
  },
  {
    caip2: 'eip155:42161',
    name: 'Arbitrum',
    shortName: 'arb',
    emoji: '🔹',
    chainId: 42161,
    nativeToken: 'ETH',
    decimals: 18,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    type: 'evm',
  },
  {
    caip2: 'eip155:56',
    name: 'BNB Chain',
    shortName: 'bsc',
    emoji: '🟡',
    chainId: 56,
    nativeToken: 'BNB',
    decimals: 18,
    rpcUrl: 'https://bsc-dataseed.binance.org',
    type: 'evm',
  },
  {
    caip2: 'eip155:43114',
    name: 'Avalanche',
    shortName: 'avax',
    emoji: '🔺',
    chainId: 43114,
    nativeToken: 'AVAX',
    decimals: 18,
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    type: 'evm',
  },
  {
    caip2: 'eip155:143',
    name: 'Monad',
    shortName: 'monad',
    emoji: '🟣',
    chainId: 143,
    nativeToken: 'MON',
    decimals: 18,
    rpcUrl: 'https://monad-mainnet.drpc.org',
    type: 'evm',
  },
  {
    caip2: 'eip155:5000',
    name: 'Mantle',
    shortName: 'mantle',
    emoji: '🟢',
    chainId: 5000,
    nativeToken: 'MNT',
    decimals: 18,
    rpcUrl: 'https://rpc.mantle.xyz',
    type: 'evm',
  },
  {
    caip2: 'eip155:130',
    name: 'Unichain',
    shortName: 'unichain',
    emoji: '🦄',
    chainId: 130,
    nativeToken: 'ETH',
    decimals: 18,
    rpcUrl: 'https://mainnet.unichain.org',
    type: 'evm',
  },
  {
    caip2: 'eip155:999',
    name: 'HyperEVM',
    shortName: 'hyperevm',
    emoji: '⚡',
    chainId: 999,
    nativeToken: 'HYPE',
    decimals: 18,
    rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
    type: 'evm',
  },
  {
    caip2: 'eip155:4326',
    name: 'MegaETH',
    shortName: 'megaeth',
    emoji: '🌐',
    chainId: 4326,
    nativeToken: 'ETH',
    decimals: 18,
    rpcUrl: 'https://mainnet.megaeth.com/rpc',
    type: 'evm',
  },
  {
    caip2: 'eip155:9745',
    name: 'Plasma',
    shortName: 'plasma',
    emoji: '⚛️',
    chainId: 9745,
    nativeToken: 'XPL',
    decimals: 18,
    rpcUrl: '',
    type: 'evm',
  },
  {
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    name: 'Solana',
    shortName: 'sol',
    emoji: '☀️',
    chainId: null,
    nativeToken: 'SOL',
    decimals: 9,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    type: 'svm',
  },
];

const chainMap = new Map(CHAINS.map((c) => [c.caip2, c]));
const shortNameMap = new Map(CHAINS.map((c) => [c.shortName, c]));

export function getChain(caip2: string): Chain | undefined {
  return chainMap.get(caip2);
}

export function getChainByShortName(name: string): Chain | undefined {
  return shortNameMap.get(name.toLowerCase());
}

export function chainLabel(caip2: string): string {
  const chain = getChain(caip2);
  return chain ? `${chain.emoji} ${chain.name}` : caip2;
}

export function evmChains(): Chain[] {
  return CHAINS.filter((c) => c.type === 'evm');
}

export function svmChains(): Chain[] {
  return CHAINS.filter((c) => c.type === 'svm');
}
