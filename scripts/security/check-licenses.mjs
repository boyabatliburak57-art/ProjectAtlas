import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync('security/license-policy.json', 'utf8'));
const inventory = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    encoding: 'utf8',
  }),
);
const observed = Object.keys(inventory);
const errors = observed.filter((license) => !policy.allowed.includes(license));
for (const license of observed.filter((value) =>
  policy.prohibited.includes(value),
))
  errors.push(`prohibited:${license}`);

if (errors.length > 0) {
  process.stderr.write(
    `License policy failed: ${[...new Set(errors)].join(', ')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `License policy PASS: ${observed.length} license expressions, ${Object.values(inventory).flat().length} production packages.\n`,
  );
}
