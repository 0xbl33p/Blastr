import { ethers } from 'ethers';
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { getChain } from './chains.js';
import type { EvmPayload } from './types.js';

// ── blastr service fee transfer ──

export interface FeeTransferSvm {
  recipient: string;
  lamports: number;
}

export interface FeeTransferEvm {
  recipient: string;
  wei: string;
}

// ── Solana payload types (from Printr API) ──

export interface SvmAccount {
  pubkey: string;
  is_signer: boolean;
  is_writable: boolean;
}

export interface SvmInstruction {
  program_id: string;
  accounts: SvmAccount[];
  data: string; // base64
}

export interface SvmPayload {
  ixs: SvmInstruction[];
  lookup_table?: string;
  mint?: string;
}

export interface SvmSubmitResult {
  signature: string;
  slot: number;
  confirmation_status: string;
}

// ── EVM signing ──

export interface EvmSubmitResult {
  tx_hash: string;
  block_number: string;
  tx_status: 'success' | 'reverted';
}

export async function signAndSubmitEvm(
  payload: EvmPayload,
  privateKey: string,
  rpcUrl?: string,
  feeTransfer?: FeeTransferEvm,
): Promise<EvmSubmitResult> {
  const chain = getChain(payload.chain_id);
  const rpc = rpcUrl || chain?.rpcUrl;
  if (!rpc) {
    throw new Error(`No RPC URL for chain ${payload.chain_id}`);
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);

  if (feeTransfer && feeTransfer.recipient && BigInt(feeTransfer.wei) > 0n) {
    const feeTx = await wallet.sendTransaction({
      to: feeTransfer.recipient,
      value: feeTransfer.wei,
    });
    await feeTx.wait();
  }

  const tx = await wallet.sendTransaction({
    to: payload.to,
    data: payload.calldata,
    value: payload.value || '0',
  });

  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error('Transaction receipt not available');
  }

  return {
    tx_hash: receipt.hash,
    block_number: receipt.blockNumber.toString(),
    tx_status: receipt.status === 1 ? 'success' : 'reverted',
  };
}

// ── Solana signing ──

const DEFAULT_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

export async function signAndSubmitSvm(
  payload: SvmPayload,
  privateKey: string,
  rpcUrl?: string,
  feeTransfer?: FeeTransferSvm,
  /** Extra instructions appended after Printr's payload (e.g., auto-stake). */
  extraIxs?: TransactionInstruction[],
): Promise<SvmSubmitResult> {
  const rpc = rpcUrl || DEFAULT_SOLANA_RPC;
  const connection = new Connection(rpc, 'confirmed');

  // Decode keypair from base58 (64 bytes: 32 secret + 32 public)
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));

  // Convert payload instructions to TransactionInstructions
  const instructions: TransactionInstruction[] = [];

  // Prepend blastr service fee transfer, if configured
  if (feeTransfer && feeTransfer.recipient && feeTransfer.lamports > 0) {
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(feeTransfer.recipient),
        lamports: feeTransfer.lamports,
      }),
    );
  }

  instructions.push(
    ...payload.ixs.map(
      (ix) =>
        new TransactionInstruction({
          programId: new PublicKey(ix.program_id),
          keys: ix.accounts.map((a) => ({
            pubkey: new PublicKey(a.pubkey),
            isSigner: a.is_signer,
            isWritable: a.is_writable,
          })),
          data: Buffer.from(ix.data, 'base64'),
        }),
    ),
  );

  // Append any caller-supplied extras (e.g. auto-stake refresh + create_stake_position)
  if (extraIxs && extraIxs.length > 0) {
    instructions.push(...extraIxs);
  }

  // Fetch the lookup table Printr returned, if any. Crucial when we add extra
  // ixs: without LUTs the wire-serialized tx blows past Solana's 1232-byte cap.
  const lookupTables: AddressLookupTableAccount[] = [];
  if (payload.lookup_table) {
    const lutAddr = new PublicKey(payload.lookup_table);
    const lutAcc = await connection.getAddressLookupTable(lutAddr);
    if (lutAcc.value) {
      lookupTables.push(lutAcc.value);
    }
  }

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // Build versioned transaction
  const message = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  const tx = new VersionedTransaction(message);
  tx.sign([keypair]);

  // Submit
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  // Confirm
  const confirmation = await connection.confirmTransaction(signature, 'confirmed');
  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  const status = await connection.getSignatureStatus(signature);

  return {
    signature,
    slot: status.value?.slot ?? 0,
    confirmation_status: status.value?.confirmationStatus ?? 'confirmed',
  };
}
