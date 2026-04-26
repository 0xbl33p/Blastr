import { sql } from '../db/index.js';
import type { FeeSink, MaxTelecoinSupply } from '../printr/types.js';
import type { LockPeriodDays } from '../printr/stake.js';

const SOLANA_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export interface QuickLaunchPreset {
  chains: string[];
  /** Initial buy amount in SOL (human units, e.g. 0.5). 0 = skip the buy. */
  initialBuySol: number;
  graduationThreshold: number;
  maxSupply: MaxTelecoinSupply;
  supplyOnCurveBps: number;
  bondingCurveDevFeeBps: number;
  ammDevFeeBps: number;
  feeSink: FeeSink;
  /** UI-only label, not sent to the Printr API. */
  profile: string;
  /** When fee_sink === 'stake_pool' and there's an initial buy, atomically
   *  stake the bought tokens in the same tx so the dev gets first-staker spot. */
  autoStakeInitial: boolean;
  /** Lock duration when auto-staking. Longer = bigger fee share. */
  stakeLockPeriod: LockPeriodDays;
}

export const DEFAULT_QUICK_PRESET: QuickLaunchPreset = {
  chains: [SOLANA_CAIP2],
  initialBuySol: 0,
  graduationThreshold: 69000,
  maxSupply: '1_billion',
  supplyOnCurveBps: 7000,
  bondingCurveDevFeeBps: 40,
  ammDevFeeBps: 20,
  feeSink: 'stake_pool',
  profile: 'memecoin',
  autoStakeInitial: true,
  stakeLockPeriod: 180,
};

class PresetStore {
  async get(userId: string): Promise<QuickLaunchPreset> {
    const [row] = await sql<{ data: QuickLaunchPreset }[]>`
      SELECT data FROM user_presets WHERE user_id = ${userId} LIMIT 1
    `;
    if (!row) return { ...DEFAULT_QUICK_PRESET };
    return { ...DEFAULT_QUICK_PRESET, ...row.data };
  }

  async set(userId: string, preset: QuickLaunchPreset): Promise<void> {
    // sql.json's parameter type uses an index-signature constraint that
    // QuickLaunchPreset doesn't satisfy structurally; the cast is safe
    // because the value is plain JSON (no functions, no cycles).
    await sql`
      INSERT INTO user_presets (user_id, data, updated_at)
      VALUES (${userId}, ${sql.json(preset as never)}, NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET data = EXCLUDED.data, updated_at = NOW()
    `;
  }

  async update(userId: string, patch: Partial<QuickLaunchPreset>): Promise<void> {
    const current = await this.get(userId);
    await this.set(userId, { ...current, ...patch });
  }

  async reset(userId: string): Promise<void> {
    await this.set(userId, { ...DEFAULT_QUICK_PRESET });
  }
}

export const presetStore = new PresetStore();
