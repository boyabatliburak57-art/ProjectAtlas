export * from './momentum.js';
export * from './moving-averages.js';
export * from './schemas.js';
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
