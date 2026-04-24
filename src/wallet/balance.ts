import { ethers } from 'ethers';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { CHAINS } from '../printr/chains.js';

interface BalanceResult {
  chain: string;
  balance: string;
}

export async function getEvmBalance(address: string): Promise<BalanceResult> {
  const chain = CHAINS.find((c) => c.type === 'evm' && c.rpcUrl);
  if (!chain) throw new Error('No EVM chain with RPC');
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const raw = await provider.getBalance(address);
  const formatted = parseFloat(ethers.formatEther(raw)).toFixed(6);
  return { chain: chain.name, balance: `${formatted} ${chain.nativeToken}` };
}

export async function getSolanaBalance(address: string): Promise<BalanceResult> {
  const chain = CHAINS.find((c) => c.type === 'svm' && c.rpcUrl);
  if (!chain) throw new Error('No Solana chain with RPC');
  const conn = new Connection(chain.rpcUrl, 'confirmed');
  const lamports = await conn.getBalance(new PublicKey(address));
  const sol = (lamports / LAMPORTS_PER_SOL).toFixed(6);
  return { chain: chain.name, balance: `${sol} SOL` };
}

export async function getBalance(
  address: string,
  type: 'evm' | 'svm',
): Promise<BalanceResult> {
  return type === 'evm' ? getEvmBalance(address) : getSolanaBalance(address);
}
