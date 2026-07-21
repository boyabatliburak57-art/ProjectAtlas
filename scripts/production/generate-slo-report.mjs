import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath)
  throw new Error('usage: generate-slo-report.mjs <window.json> <report.md>');

const window = JSON.parse(await readFile(inputPath, 'utf8'));
const availability = ratio(
  window.apiSuccessfulRequests,
  window.apiEligibleRequests,
);
const workerTerminal = ratio(
  window.workerSuccessfulTerminalJobs,
  window.workerEligibleJobs,
);
const target = 0.999;
const allowedBad = window.apiEligibleRequests * (1 - target);
const actualBad = window.apiEligibleRequests - window.apiSuccessfulRequests;
const remainingBudget = Math.max(0, 1 - actualBad / allowedBad);
const releaseDecision =
  availability >= target &&
  workerTerminal >= 0.995 &&
  window.activeFastBurnAlerts === 0
    ? 'ALLOW_CONTROLLED_ROLLOUT'
    : 'FREEZE_OR_RISK_REVIEW';
const journeys = Object.entries(window.journeys)
  .map(([name, value]) => `| ${name} | ${(value * 100).toFixed(3)}% |`)
  .join('\n');
const markdown = `# SLO and Error Budget Report

- Policy: \`slo-v1\`
- Window: ${window.windowStartedAt} — ${window.windowEndedAt}
- API availability: ${(availability * 100).toFixed(4)}% (target ≥ 99.9%)
- Worker successful terminal rate: ${(workerTerminal * 100).toFixed(4)}% (target ≥ 99.5%)
- API error budget remaining: ${(remainingBudget * 100).toFixed(2)}%
- Active fast-burn alerts: ${window.activeFastBurnAlerts}
- Release decision: **${releaseDecision}**

| Journey | Successful terminal/freshness ratio |
| --- | ---: |
${journeys}

Existing milestone latency thresholds remain authoritative and unchanged.
`;
await writeFile(outputPath, markdown);
process.stdout.write(`${releaseDecision}: ${outputPath}\n`);

function ratio(numerator, denominator) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  )
    throw new Error(
      'SLI counters must be finite and denominator must be positive',
    );
  return numerator / denominator;
}
