/**
 * Hand-rolled instruction builders for Printr's on-chain staking.
 *
 * All discriminators, account orders, and PDA seeds are derived directly from
 * the Printr Anchor IDL pinned at src/printr/idl.json. We build instructions
 * without pulling in @coral-xyz/anchor (would add ~3MB and another runtime
 * dep) by Borsh-encoding the args inline — it's literally u32 + u64 + u8.
 *
 * On wire, create_stake_position data is exactly 21 bytes:
 *     [0..8]  discriminator   = 0x5ca860856679568a
 *     [8..12] position_nonce  : u32 LE  (random per position)
 *     [12..20] to_stake.amount: u64 LE  (raw atomic units)
 *     [20]    lock_period     : u8      (enum variant index)
 */
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  AccountMeta,
} from '@solana/web3.js';
import { randomBytes } from 'node:crypto';
import type { SvmInstruction } from './signer.js';

// ── program IDs ──
export const PRINTR_PROGRAM = new PublicKey('T8HsGYv7sMk3kTnyaRqZrbRPuntYzdh12evXBkprint');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ── instruction discriminators (verified against on-chain IDL) ──
const DISC_CREATE_STAKE_POSITION = Buffer.from([0x5c, 0xa8, 0x60, 0x85, 0x66, 0x79, 0x56, 0x8a]);
const DISC_REFRESH_STAKING_2 = Buffer.from([0x24, 0xc5, 0xc3, 0x1b, 0x08, 0xe0, 0x76, 0x1b]);
// print_telecoin2 (current) and print_telecoin (legacy) — both have identical
// account layouts. Printr's launch payload contains the print_telecoin* ix at
// the top level; the actual `Swap` (initial buy) is a CPI inside it.
const DISC_PRINT_TELECOIN_2 = Buffer.from([0xa6, 0x3c, 0x26, 0x2b, 0xee, 0x20, 0x02, 0xa0]);
const DISC_PRINT_TELECOIN = Buffer.from([0xd6, 0x1e, 0x04, 0x66, 0xcf, 0x49, 0x6c, 0x23]);

// ── lock period enum (matches Printr's IDL ordering) ──
export type LockPeriodDays = 7 | 14 | 30 | 60 | 90 | 180;
const LOCK_PERIOD_INDEX: Record<LockPeriodDays, number> = {
  7: 0,
  14: 1,
  30: 2,
  60: 3,
  90: 4,
  180: 5,
  // 6 = TenSeconds (test variant); intentionally not exposed.
};

// ── PDA helpers ──
function findPda(seeds: (Buffer | Uint8Array)[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

/** ATA derivation matching the @solana/spl-token convention. */
function deriveAta(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return findPda(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  );
}

const PRINTR_AUTHORITY = findPda([Buffer.from('printr_authority')], PRINTR_PROGRAM);
const PRINTR_CONFIG = findPda([Buffer.from('printr_config')], PRINTR_PROGRAM);
const EVENT_AUTHORITY = findPda([Buffer.from('__event_authority')], PRINTR_PROGRAM);

function deriveDevConfig(mint: PublicKey): PublicKey {
  return findPda([Buffer.from('dev_config'), mint.toBuffer()], PRINTR_PROGRAM);
}
function deriveStakingPool(mint: PublicKey): PublicKey {
  return findPda([Buffer.from('staking_pool'), mint.toBuffer()], PRINTR_PROGRAM);
}
function deriveStakePosition(mint: PublicKey, owner: PublicKey, nonce: number): PublicKey {
  const nonceBuf = Buffer.alloc(4);
  nonceBuf.writeUInt32LE(nonce);
  return findPda(
    [Buffer.from('stake_position'), mint.toBuffer(), owner.toBuffer(), nonceBuf],
    PRINTR_PROGRAM,
  );
}
function deriveQuoteFeeVault(quoteMint: PublicKey): PublicKey {
  return findPda([Buffer.from('devs_fee_vault'), quoteMint.toBuffer()], PRINTR_PROGRAM);
}

// ── on-chain config (cached) ──
interface PrintrConfig {
  printrFeeAuthority: PublicKey;
  stakingAuthority: PublicKey;
}

let configCache: PrintrConfig | null = null;

/**
 * Fetch and cache the global PrintrConfig. The two pubkeys we need are at
 * stable offsets after Anchor's 8-byte account discriminator:
 *     [0..8]   discriminator
 *     [8..40]  printr_fee_authority   (32 bytes)
 *     [40..72] questflow_ai_fee_authority (32 bytes)
 *     [72..104] _padding_1            (32 bytes)
 *     [104..136] staking_authority    (32 bytes)
 */
export async function loadPrintrConfig(connection: Connection): Promise<PrintrConfig> {
  if (configCache) return configCache;
  const acc = await connection.getAccountInfo(PRINTR_CONFIG);
  if (!acc) throw new Error('PrintrConfig account not found on-chain');
  if (acc.data.length < 136) {
    throw new Error(`PrintrConfig data too short: ${acc.data.length} bytes`);
  }
  configCache = {
    printrFeeAuthority: new PublicKey(acc.data.subarray(8, 40)),
    stakingAuthority: new PublicKey(acc.data.subarray(104, 136)),
  };
  return configCache;
}

// ── extract per-token accounts from Printr's launch payload ──

/**
 * Pull the dbc_config / dbc_pool / quote_mint pubkeys out of Printr's launch
 * payload by locating the print_telecoin* instruction. The `Swap` we see in
 * on-chain logs is a CPI inside print_telecoin2, not a top-level ix, so we
 * read these accounts from the print_telecoin* account list directly.
 *
 * print_telecoin2 + print_telecoin have identical layouts:
 *   [4]  quote_mint
 *   [9]  dbc_config
 *   [11] dbc_pool
 */
interface LaunchContextAccounts {
  dbcConfig: PublicKey;
  dbcPool: PublicKey;
  quoteMint: PublicKey;
}

export function extractStakeContextFromPayload(
  ixs: SvmInstruction[],
): LaunchContextAccounts {
  const printrProgramStr = PRINTR_PROGRAM.toBase58();
  const printIx = ixs.find((ix) => {
    if (ix.program_id !== printrProgramStr) return false;
    const data = Buffer.from(ix.data, 'base64');
    const head = data.subarray(0, 8);
    return head.equals(DISC_PRINT_TELECOIN_2) || head.equals(DISC_PRINT_TELECOIN);
  });
  if (!printIx) {
    throw new Error(
      'no print_telecoin instruction found in launch payload — auto-stake needs it to extract dbc_config + dbc_pool',
    );
  }
  return {
    quoteMint: new PublicKey(printIx.accounts[4].pubkey),
    dbcConfig: new PublicKey(printIx.accounts[9].pubkey),
    dbcPool: new PublicKey(printIx.accounts[11].pubkey),
  };
}

// ── instruction builders ──

function meta(pubkey: PublicKey, isWritable: boolean, isSigner = false): AccountMeta {
  return { pubkey, isWritable, isSigner };
}

interface StakeContext {
  payer: PublicKey;        // also the position_owner
  telecoinMint: PublicKey;
  quoteMint: PublicKey;
  dbcConfig: PublicKey;
  dbcPool: PublicKey;
  config: PrintrConfig;
}

/**
 * refresh_staking2 — refreshes pool accumulators so a new stake doesn't claim
 * back-rewards. Zero args; just the account ordering matters.
 */
export function buildRefreshStaking2Ix(ctx: StakeContext): TransactionInstruction {
  const stakingPool = deriveStakingPool(ctx.telecoinMint);
  const devConfig = deriveDevConfig(ctx.telecoinMint);
  const quoteFeeVault = deriveQuoteFeeVault(ctx.quoteMint);
  // Quote token program: standard Token program for wSOL; will need overriding
  // if Printr ever quotes in a Token-2022 asset. Today it's always wSOL.
  const quoteTokenProgram = TOKEN_PROGRAM;
  const printrQuoteFeeWallet = deriveAta(
    ctx.config.printrFeeAuthority,
    ctx.quoteMint,
    quoteTokenProgram,
  );
  const protocolTelecoinAuthority = ctx.config.stakingAuthority;
  const protocolTelecoinWallet = deriveAta(
    protocolTelecoinAuthority,
    ctx.telecoinMint,
    TOKEN_2022_PROGRAM,
  );
  const poolTelecoinVault = deriveAta(stakingPool, ctx.telecoinMint, TOKEN_2022_PROGRAM);

  const keys: AccountMeta[] = [
    meta(ctx.payer, true, true),                     // [ 0] payer
    meta(PRINTR_CONFIG, true),                       // [ 1] printr_config
    meta(printrQuoteFeeWallet, true),                // [ 2] printr_quote_fee_wallet
    meta(quoteFeeVault, true),                       // [ 3] quote_fee_vault
    meta(PRINTR_PROGRAM, true),                      // [ 4] revshare1 (optional → program as null)
    meta(PRINTR_PROGRAM, true),                      // [ 5] revshare2 (optional → program as null)
    meta(stakingPool, true),                         // [ 6] staking_pool
    meta(devConfig, true),                           // [ 7] dev_config
    meta(ctx.dbcConfig, false),                      // [ 8] dbc_config
    meta(ctx.dbcPool, false),                        // [ 9] dbc_pool
    meta(ctx.telecoinMint, false),                   // [10] telecoin_mint
    meta(ctx.quoteMint, false),                      // [11] quote_mint
    meta(poolTelecoinVault, true),                   // [12] pool_telecoin_vault
    meta(protocolTelecoinWallet, true),              // [13] protocol_telecoin_wallet
    meta(protocolTelecoinAuthority, false),          // [14] protocol_telecoin_authority
    meta(TOKEN_2022_PROGRAM, false),                 // [15] telecoin_token_program
    meta(quoteTokenProgram, false),                  // [16] quote_token_program
    meta(ATA_PROGRAM, false),                        // [17] associated_token_program
    meta(SYSTEM_PROGRAM, false),                     // [18] system_program
    meta(EVENT_AUTHORITY, false),                    // [19] event_authority
    meta(PRINTR_PROGRAM, false),                     // [20] program
  ];

  return new TransactionInstruction({
    programId: PRINTR_PROGRAM,
    keys,
    data: Buffer.from(DISC_REFRESH_STAKING_2),
  });
}

/**
 * create_stake_position — locks `amount` of `mint` for `lockPeriod` days.
 * `nonce` lets the same user hold multiple positions on the same telecoin.
 */
export function buildCreateStakePositionIx(
  ctx: StakeContext,
  args: { positionNonce: number; toStakeAmount: bigint; lockPeriod: LockPeriodDays },
): TransactionInstruction {
  const stakingPool = deriveStakingPool(ctx.telecoinMint);
  const devConfig = deriveDevConfig(ctx.telecoinMint);
  const stakePosition = deriveStakePosition(ctx.telecoinMint, ctx.payer, args.positionNonce);
  const payerTelecoinAccount = deriveAta(ctx.payer, ctx.telecoinMint, TOKEN_2022_PROGRAM);
  const poolTelecoinVault = deriveAta(stakingPool, ctx.telecoinMint, TOKEN_2022_PROGRAM);

  const keys: AccountMeta[] = [
    meta(ctx.payer, true, true),                     // [ 0] payer
    meta(ctx.payer, true),                           // [ 1] position_owner (= payer)
    meta(PRINTR_AUTHORITY, false),                   // [ 2] printr_authority
    meta(devConfig, false),                          // [ 3] dev_config
    meta(stakingPool, true),                         // [ 4] staking_pool
    meta(stakePosition, true),                       // [ 5] stake_position
    meta(payerTelecoinAccount, true),                // [ 6] payer_telecoin_account
    meta(poolTelecoinVault, true),                   // [ 7] pool_telecoin_vault
    meta(ctx.telecoinMint, false),                   // [ 8] telecoin_mint
    meta(TOKEN_2022_PROGRAM, false),                 // [ 9] telecoin_token_program
    meta(ATA_PROGRAM, false),                        // [10] associated_token_program
    meta(SYSTEM_PROGRAM, false),                     // [11] system_program
    meta(EVENT_AUTHORITY, false),                    // [12] event_authority
    meta(PRINTR_PROGRAM, false),                     // [13] program
  ];

  // Borsh: u32 LE + u64 LE + u8
  const data = Buffer.alloc(8 + 4 + 8 + 1);
  DISC_CREATE_STAKE_POSITION.copy(data, 0);
  data.writeUInt32LE(args.positionNonce, 8);
  data.writeBigUInt64LE(args.toStakeAmount, 12);
  data.writeUInt8(LOCK_PERIOD_INDEX[args.lockPeriod], 20);

  return new TransactionInstruction({
    programId: PRINTR_PROGRAM,
    keys,
    data,
  });
}

// ── high-level helper ──

export interface BuildAutoStakeArgs {
  /** Bundle of ixs returned by Printr's /print endpoint (we extract context from these). */
  payloadIxs: SvmInstruction[];
  /** The signer / token recipient. Must match the launch tx's signer. */
  owner: PublicKey;
  /** Telecoin mint being launched. From SvmPayload.mint. */
  telecoinMint: PublicKey;
  /** Raw atomic units to stake (already buffered for slippage by caller). */
  toStakeAmount: bigint;
  /** Lock duration in days. */
  lockPeriod: LockPeriodDays;
  /** RPC connection for fetching the global PrintrConfig (cached after first call). */
  connection: Connection;
}

/**
 * Build the full pair of instructions to atomically refresh + stake on top of
 * a Printr launch payload. Caller appends these to the launch ixs and signs
 * the whole thing as one VersionedTransaction.
 *
 * Random nonce is generated here so positions don't collide across launches.
 */
export async function buildAutoStakeIxs(
  args: BuildAutoStakeArgs,
): Promise<TransactionInstruction[]> {
  const { dbcConfig, dbcPool, quoteMint } = extractStakeContextFromPayload(args.payloadIxs);
  const config = await loadPrintrConfig(args.connection);

  const ctx: StakeContext = {
    payer: args.owner,
    telecoinMint: args.telecoinMint,
    quoteMint,
    dbcConfig,
    dbcPool,
    config,
  };

  const positionNonce = randomBytes(4).readUInt32LE();

  return [
    buildRefreshStaking2Ix(ctx),
    buildCreateStakePositionIx(ctx, {
      positionNonce,
      toStakeAmount: args.toStakeAmount,
      lockPeriod: args.lockPeriod,
    }),
  ];
}

// Re-export the ws sol mint for callers that want to confirm quote-mint assumption.
export { WSOL_MINT };

// ── Pre-flight evaluator (called before/during the launch confirm) ──

export type AutoStakePlanReason =
  | 'ready'
  | 'no-stake-pool-fee-sink'
  | 'no-initial-buy'
  | 'no-solana-chain'
  | 'disabled-by-user';

export interface AutoStakePlan {
  /** True when conditions are met to build + execute auto-stake. */
  willStake: boolean;
  reason: AutoStakePlanReason;
  /** Lock period to use if willStake is true. */
  lockPeriod: LockPeriodDays;
  /** Initial buy in human SOL units (display only). */
  initialBuySol: number;
}

/**
 * Decide whether auto-stake will happen for this launch and explain why
 * (or why not). Used by both the confirm-screen status line and the
 * post-launch result message so the user always knows what's happening.
 */
export function planAutoStake(args: {
  feeSink: string;
  initialBuySol: number;
  hasSolanaChain: boolean;
  autoStakeInitial: boolean;
  stakeLockPeriod: LockPeriodDays;
}): AutoStakePlan {
  const base = { lockPeriod: args.stakeLockPeriod, initialBuySol: args.initialBuySol };
  if (args.feeSink !== 'stake_pool') {
    return { willStake: false, reason: 'no-stake-pool-fee-sink', ...base };
  }
  if (!args.autoStakeInitial) {
    return { willStake: false, reason: 'disabled-by-user', ...base };
  }
  if (args.initialBuySol <= 0) {
    return { willStake: false, reason: 'no-initial-buy', ...base };
  }
  if (!args.hasSolanaChain) {
    return { willStake: false, reason: 'no-solana-chain', ...base };
  }
  return { willStake: true, reason: 'ready', ...base };
}

/** Render the plan as a short HTML line for the confirm/result screens. */
export function renderAutoStakeStatus(plan: AutoStakePlan): string {
  if (plan.willStake) {
    return `🔒 <b>Auto-stake:</b> initial buy → locked ${plan.lockPeriod}d (first-staker bonus)`;
  }
  switch (plan.reason) {
    case 'no-stake-pool-fee-sink':
      // Surface that auto-stake is a stake_pool-only feature so devs who
      // picked another fee sink know what they're opting out of.
      return '🔒 <b>Auto-stake:</b> available when fee sink is 💎 Proof of Belief';
    case 'disabled-by-user':
      return '🔒 <b>Auto-stake:</b> off (enable in /settings)';
    case 'no-initial-buy':
      return '🔒 <b>Auto-stake:</b> skipped — requires initial buy &gt; 0';
    case 'no-solana-chain':
      return '🔒 <b>Auto-stake:</b> Solana-only (skipped)';
    default:
      return '';
  }
}
