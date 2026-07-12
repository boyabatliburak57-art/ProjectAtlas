import type { ScanExecutionPlan } from './contracts.js';

export function serializeScanExecutionPlan(plan: ScanExecutionPlan): string {
  return JSON.stringify(plan);
}
