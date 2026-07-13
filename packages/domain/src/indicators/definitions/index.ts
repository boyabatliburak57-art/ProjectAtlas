export * from './momentum.js';
export * from './moving-averages.js';
export * from './schemas.js';
export * from './set-b-oscillators.js';
export * from './set-b-trend.js';
export * from './set-b-volume.js';
export * from './directional-trend.js';
export * from './volatility.js';
export * from './volume.js';

import {
  momentumDefinition,
  rocDefinition,
  rsiDefinition,
} from './momentum.js';
import {
  emaDefinition,
  smaDefinition,
  wmaDefinition,
} from './moving-averages.js';
import { atrDefinition } from './volatility.js';
import {
  cciDefinition,
  stochasticDefinition,
  stochasticRsiDefinition,
  williamsRDefinition,
} from './set-b-oscillators.js';
import {
  bollingerBandsDefinition,
  donchianChannelDefinition,
  keltnerChannelDefinition,
  macdDefinition,
} from './set-b-trend.js';
import { cmfDefinition, mfiDefinition } from './set-b-volume.js';
import {
  obvDefinition,
  relativeVolumeDefinition,
  volumeSmaDefinition,
} from './volume.js';

export const CORE_INDICATORS_SET_A = [
  smaDefinition,
  emaDefinition,
  wmaDefinition,
  rocDefinition,
  momentumDefinition,
  atrDefinition,
  rsiDefinition,
  obvDefinition,
  volumeSmaDefinition,
  relativeVolumeDefinition,
] as const;

export const CORE_INDICATORS_SET_B = [
  macdDefinition,
  bollingerBandsDefinition,
  donchianChannelDefinition,
  stochasticDefinition,
  stochasticRsiDefinition,
  cciDefinition,
  williamsRDefinition,
  cmfDefinition,
  mfiDefinition,
  keltnerChannelDefinition,
] as const;
