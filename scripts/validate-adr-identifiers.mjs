import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADR_FILENAME_PATTERN = /^ADR-(\d{3})-[A-Za-z0-9].*\.md$/;
const ADR_HEADER_PATTERN = /^# ADR-(\d{3})\s+—\s+.+$/;
const ADR_INDEX_ENTRY_PATTERN = /^\|\s*ADR-(\d{3})\s*\|/gm;

function duplicateIdentifiers(identifiers) {
  const seen = new Set();
  const duplicates = new Set();

  for (const identifier of identifiers) {
    if (seen.has(identifier)) {
      duplicates.add(identifier);
    }
    seen.add(identifier);
  }

  return [...duplicates].sort();
}

export async function validateAdrRepository({
  architectureDirectory,
  indexPath,
}) {
  const errors = [];
  const directoryEntries = await readdir(architectureDirectory, {
    withFileTypes: true,
  });
  const adrFiles = directoryEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith('ADR-') &&
        entry.name.endsWith('.md'),
    )
    .map((entry) => entry.name)
    .sort();
  const fileIdentifiers = [];

  for (const fileName of adrFiles) {
    const filenameMatch = ADR_FILENAME_PATTERN.exec(fileName);
    if (filenameMatch === null) {
      errors.push(`Invalid ADR filename: ${fileName}`);
      continue;
    }

    const fileIdentifier = filenameMatch[1];
    fileIdentifiers.push(fileIdentifier);
    const contents = await readFile(
      resolve(architectureDirectory, fileName),
      'utf8',
    );
    const firstLine = contents.split(/\r?\n/, 1)[0] ?? '';
    const headerMatch = ADR_HEADER_PATTERN.exec(firstLine);

    if (headerMatch === null) {
      errors.push(`Invalid ADR H1 in ${fileName}: ${firstLine || '<empty>'}`);
    } else if (headerMatch[1] !== fileIdentifier) {
      errors.push(
        `ADR identifier mismatch in ${fileName}: filename ADR-${fileIdentifier}, H1 ADR-${headerMatch[1]}`,
      );
    }
  }

  for (const identifier of duplicateIdentifiers(fileIdentifiers)) {
    errors.push(`Duplicate ADR file identifier: ADR-${identifier}`);
  }

  const indexContents = await readFile(indexPath, 'utf8');
  const indexIdentifiers = [
    ...indexContents.matchAll(ADR_INDEX_ENTRY_PATTERN),
  ].map((match) => match[1]);
  for (const identifier of duplicateIdentifiers(indexIdentifiers)) {
    errors.push(`Duplicate ADR index identifier: ADR-${identifier}`);
  }

  const fileIdentifierSet = new Set(fileIdentifiers);
  const indexIdentifierSet = new Set(indexIdentifiers);
  for (const identifier of [...fileIdentifierSet].sort()) {
    if (!indexIdentifierSet.has(identifier)) {
      errors.push(
        `ADR-${identifier} exists as a file but is missing from ADR_INDEX.md`,
      );
    }
  }
  for (const identifier of [...indexIdentifierSet].sort()) {
    if (!fileIdentifierSet.has(identifier)) {
      errors.push(
        `ADR-${identifier} exists in ADR_INDEX.md but has no ADR file`,
      );
    }
  }

  return { adrFiles, errors };
}

async function runCli() {
  const architectureDirectory = resolve(process.cwd(), 'architecture');
  const indexPath = resolve(architectureDirectory, 'ADR_INDEX.md');
  const result = await validateAdrRepository({
    architectureDirectory,
    indexPath,
  });

  if (result.errors.length > 0) {
    process.stderr.write(`${result.errors.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `ADR identifier validation passed (${result.adrFiles.length} files).\n`,
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  fileURLToPath(import.meta.url) === resolve(invokedPath)
) {
  await runCli();
}
