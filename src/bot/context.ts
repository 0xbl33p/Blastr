import { Context, Scenes } from 'telegraf';
import type { ExternalLinks, FeeSink, MaxTelecoinSupply } from '../printr/types.js';

export interface LaunchState {
  name: string;
  symbol: string;
  description: string;
  image: string;
  chains: string[];
  initialBuyUsd: number;
  graduationThreshold: number;
  // ── advanced launch params ──
  maxSupply: MaxTelecoinSupply;
  supplyOnCurveBps: number;
  bondingCurveDevFeeBps: number;
  ammDevFeeBps: number;
  feeSink: FeeSink;
  // ── socials + profile ──
  externalLinks: ExternalLinks;
  /** UI-only label (memecoin / utility / …). Not sent to Printr. */
  profile: string;
}

export interface SessionData
  extends Scenes.WizardSession<Scenes.WizardSessionData> {
  launch: Partial<LaunchState>;
  _lastMsgId?: number;
  _quoteMode?: boolean;
  _walletImportMode?: 'evm' | 'svm' | false;
  /** Active field being edited in the Quick Launch settings flow. */
  _qlSettingsEdit?:
    | false
    | 'chains'
    | 'initialBuy'
    | 'graduation'
    | 'maxSupply'
    | 'supplyRatio'
    | 'bondingFee'
    | 'ammFee'
    | 'feeSink'
    | 'profile';
}

export interface BotContext extends Context {
  session: SessionData;
  scene: Scenes.SceneContextScene<BotContext, Scenes.WizardSessionData>;
  wizard: Scenes.WizardContextWizard<BotContext>;
}
