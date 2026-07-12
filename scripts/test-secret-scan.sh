#!/usr/bin/env bash

set -euo pipefail

readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly gitleaks_binary="$(bash "$repository_root/scripts/install-gitleaks.sh")"

if [[ ! -x "$gitleaks_binary" ]]; then
  echo 'Pinned Gitleaks binary is unavailable or not executable.' >&2
  exit 1
fi

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

# The value is deterministically generated at runtime and is not a credential.
# Keeping it out of the repository prevents the scanner test itself becoming a finding.
if command -v sha256sum >/dev/null 2>&1; then
  synthetic_value="$(printf '%s' 'project-atlas-gitleaks-synthetic-fixture' | sha256sum | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  synthetic_value="$(printf '%s' 'project-atlas-gitleaks-synthetic-fixture' | shasum -a 256 | awk '{print $1}')"
else
  echo 'No SHA-256 command is available for the synthetic test.' >&2
  exit 1
fi
printf 'api_key = "%s"\n' "$synthetic_value" > "$temporary_directory/synthetic.txt"

set +e
"$gitleaks_binary" dir "$temporary_directory" \
  --config "$repository_root/.gitleaks.toml" \
  --redact=100 \
  --no-banner \
  --exit-code 1 \
  > /dev/null 2>&1
scan_status=$?
set -e

if [[ "$scan_status" -ne 1 ]]; then
  echo 'Synthetic secret detection did not fail with the expected status.' >&2
  exit 1
fi

echo 'Synthetic secret detection passed (finding content redacted).'
