import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

interface GeneratedWallet {
  address: string;
  privateKey: string;
  type: 'evm' | 'svm';
}

export function generateEvmWallet(): GeneratedWallet {
  const wallet = ethers.Wallet.createRandom();
  return { address: wallet.address, privateKey: wallet.privateKey, type: 'evm' };
}

export function generateSolanaWallet(): GeneratedWallet {
  const keypair = Keypair.generate();
  return {
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
    type: 'svm',
  };
}

export function importEvmWallet(privateKey: string): GeneratedWallet {
  const wallet = new ethers.Wallet(privateKey);
  return { address: wallet.address, privateKey: wallet.privateKey, type: 'evm' };
}

export function importSolanaWallet(privateKey: string): GeneratedWallet {
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  return {
    address: keypair.publicKey.toBase58(),
    privateKey,
    type: 'svm',
  };
}
