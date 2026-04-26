/**
 * Sell instruction builder for Printr's `swap` instruction.
 *
 * Reuses the same Printr program (T8HsGYv...) as the launch flow — the swap
 * ix is multi-purpose, working for both pre-graduation (DBC bonding curve)
 * and post-graduation (DAMM v2 AMM) tokens via a unified account list.
 *
 * SwapIntent enum (Borsh-encoded after the 8-byte ix discriminator):
 *     SellTelecoin (variant 1):
 *         [0]      0x01                       — variant index
 *         [1..9]   sell.amount (u64 LE)       — raw token units to sell
 *         [9..25]  min_price.price (u128 LE)  — sqrt-bitshifted slippage floor
 *
 * For the v1 sell flow we send min_price = 0 (no on-chain slippage check).
 * The user accepts whatever the bonding curve gives them. v2 will compute
 * a sane min_price from the current pool state.
 */
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  AccountMeta,
} from '@solana/web3.js';
import { PRINTR_PROGRAM, WSOL_MINT } from './stake.js';
import type { SvmInstruction } from './signer.js';
import type { SwapContext } from '../store/tokens.js';

// ── known program IDs ──
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
const DBC_PROGRAM = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
const DAMM_PROGRAM = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');

// swap ix discriminator = sha256("global:swap")[:8]
const DISC_SWAP = Buffer.from([0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8]);

const SELL_TELECOIN_VARIANT = 0x01;

// PDA helpers (mirror src/printr/stake.ts)
function findPda(seeds: (Buffer | Uint8Array)[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function deriveAta(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return findPda(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  );
}

const PRINTR_AUTHORITY = findPda([Buffer.from('printr_authority')], PRINTR_PROGRAM);

function deriveDammPositionNftMint(telecoinMint: PublicKey): PublicKey {
  return findPda(
    [Buffer.from('printr_damm_position_nft_mint'), telecoinMint.toBuffer()],
    PRINTR_PROGRAM,
  );
}

// ── extract swap context from a Printr launch payload ──

/**
 * Pull the per-token swap accounts out of the launch tx that Printr returned.
 * These accounts are stable for the life of the token (PDA addresses), so
 * caching them at launch time means sell ixs don't need any Printr API calls.
 *
 * Account indices match the swap instruction definition in idl.json.
 */
export function extractSwapContext(
  payloadIxs: SvmInstruction[],
  telecoinMint: string,
): SwapContext | null {
  const printrProgramStr = PRINTR_PROGRAM.toBase58();
  const swapIx = payloadIxs.find((ix) => {
    if (ix.program_id !== printrProgramStr) return false;
    const data = Buffer.from(ix.data, 'base64');
    return data.subarray(0, 8).equals(DISC_SWAP);
  });
  if (!swapIx) return null;
  const a = swapIx.accounts;
  if (a.length < 27) return null;
  return {
    telecoinMint,
    quoteMint: a[5].pubkey,
    dbcPoolAuthority: a[6].pubkey,
    dbcConfig: a[7].pubkey,
    dbcPool: a[8].pubkey,
    dbcTelecoinVault: a[9].pubkey,
    dbcQuoteVault: a[10].pubkey,
    dbcEventAuthority: a[11].pubkey,
    dbcMigrationMetadata: a[12].pubkey,
    dammPrintrPartnerConfig: a[13].pubkey,
    dammPool: a[14].pubkey,
    dammPoolAuthority: a[15].pubkey,
    dammTelecoinVault: a[16].pubkey,
    dammQuoteVault: a[17].pubkey,
    dammPositionNftAccount: a[19].pubkey,
    dammPosition: a[20].pubkey,
    dammEventAuthority: a[21].pubkey,
    quoteTokenProgram: a[23].pubkey,
  };
}

// ── instruction builder ──

function meta(pubkey: PublicKey, isWritable: boolean, isSigner = false): AccountMeta {
  return { pubkey, isWritable, isSigner };
}

export interface BuildSellIxArgs {
  payer: PublicKey;
  telecoinMint: PublicKey;
  /** Raw atomic token units to sell (u64). */
  sellAmount: bigint;
  ctx: SwapContext;
}

export function buildSellIx(args: BuildSellIxArgs): TransactionInstruction {
  const quoteMint = new PublicKey(args.ctx.quoteMint);
  const quoteTokenProgram = new PublicKey(args.ctx.quoteTokenProgram);

  // input = telecoin (Token-2022); output = quote (usually wSOL via standard Token program)
  const inputWallet = deriveAta(args.payer, args.telecoinMint, TOKEN_2022_PROGRAM);
  const outputWallet = deriveAta(args.payer, quoteMint, quoteTokenProgram);
  const dammPositionNftMint = deriveDammPositionNftMint(args.telecoinMint);

  const keys: AccountMeta[] = [
    meta(args.payer, true, true),                                           // [ 0] payer
    meta(PRINTR_AUTHORITY, true),                                           // [ 1] printr_authority
    meta(inputWallet, true),                                                // [ 2] input_wallet
    meta(outputWallet, true),                                               // [ 3] output_wallet
    meta(args.telecoinMint, true),                                          // [ 4] telecoin_mint
    meta(quoteMint, true),                                                  // [ 5] quote_mint
    meta(new PublicKey(args.ctx.dbcPoolAuthority), true),                   // [ 6] dbc_pool_authority
    meta(new PublicKey(args.ctx.dbcConfig), false),                         // [ 7] dbc_config
    meta(new PublicKey(args.ctx.dbcPool), true),                            // [ 8] dbc_pool
    meta(new PublicKey(args.ctx.dbcTelecoinVault), true),                   // [ 9] dbc_telecoin_vault
    meta(new PublicKey(args.ctx.dbcQuoteVault), true),                      // [10] dbc_quote_vault
    meta(new PublicKey(args.ctx.dbcEventAuthority), false),                 // [11] dbc_event_authority
    meta(new PublicKey(args.ctx.dbcMigrationMetadata), true),               // [12] dbc_migration_metadata
    meta(new PublicKey(args.ctx.dammPrintrPartnerConfig), false),           // [13] damm_printr_partner_config
    meta(new PublicKey(args.ctx.dammPool), true),                           // [14] damm_pool
    meta(new PublicKey(args.ctx.dammPoolAuthority), false),                 // [15] damm_pool_authority
    meta(new PublicKey(args.ctx.dammTelecoinVault), true),                  // [16] damm_telecoin_vault
    meta(new PublicKey(args.ctx.dammQuoteVault), true),                     // [17] damm_quote_vault
    meta(dammPositionNftMint, true),                                        // [18] damm_position_nft_mint
    meta(new PublicKey(args.ctx.dammPositionNftAccount), true),             // [19] damm_position_nft_account
    meta(new PublicKey(args.ctx.dammPosition), true),                       // [20] damm_position
    meta(new PublicKey(args.ctx.dammEventAuthority), false),                // [21] damm_event_authority
    meta(TOKEN_2022_PROGRAM, false),                                        // [22] telecoin_token_program
    meta(quoteTokenProgram, false),                                         // [23] quote_token_program
    meta(DBC_PROGRAM, false),                                               // [24] dbc_program
    meta(DAMM_PROGRAM, false),                                              // [25] damm_program
    meta(SYSTEM_PROGRAM, false),                                            // [26] system_program
  ];

  // Borsh: SwapIntent::SellTelecoin { sell: u64, min_price: u128 }
  // Layout: 8-byte disc + 1-byte variant + 8-byte u64 + 16-byte u128 = 33 bytes
  const data = Buffer.alloc(8 + 1 + 8 + 16);
  DISC_SWAP.copy(data, 0);
  data.writeUInt8(SELL_TELECOIN_VARIANT, 8);
  data.writeBigUInt64LE(args.sellAmount, 9);
  // min_price = 0 for v1 (accept any output). Future: compute from current pool state.
  data.writeBigUInt64LE(0n, 17);
  data.writeBigUInt64LE(0n, 25);

  return new TransactionInstruction({
    programId: PRINTR_PROGRAM,
    keys,
    data,
  });
}

// ── balance lookup helper ──

/**
 * Read the user's current Token-2022 balance for the given mint.
 * Returns 0n if the ATA doesn't exist yet.
 */
export async function getTelecoinBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<bigint> {
  const ata = deriveAta(owner, mint, TOKEN_2022_PROGRAM);
  try {
    const balance = await connection.getTokenAccountBalance(ata);
    return BigInt(balance.value.amount);
  } catch {
    // ATA likely doesn't exist (user has zero balance)
    return 0n;
  }
}

export { WSOL_MINT };
