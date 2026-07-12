#!/usr/bin/env bash

set -euo pipefail

readonly PINNED_GITLEAKS_VERSION='8.30.1'
readonly REQUESTED_GITLEAKS_VERSION="${GITLEAKS_VERSION:-$PINNED_GITLEAKS_VERSION}"

if [[ "$REQUESTED_GITLEAKS_VERSION" != "$PINNED_GITLEAKS_VERSION" ]]; then
  echo 'Gitleaks version override does not match the repository pin.' >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) platform='darwin' ;;
  Linux) platform='linux' ;;
  *)
    echo 'Unsupported operating system for the pinned Gitleaks bootstrap.' >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) architecture='arm64' ;;
  x86_64 | amd64) architecture='x64' ;;
  *)
    echo 'Unsupported CPU architecture for the pinned Gitleaks bootstrap.' >&2
    exit 1
    ;;
esac

case "${platform}_${architecture}" in
  darwin_arm64) expected_checksum='b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5' ;;
  darwin_x64) expected_checksum='dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709' ;;
  linux_arm64) expected_checksum='e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080' ;;
  linux_x64) expected_checksum='551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb' ;;
  *)
    echo 'No checksum is configured for this Gitleaks release asset.' >&2
    exit 1
    ;;
esac

readonly cache_root="${ATLAS_TOOL_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/project-atlas}"
readonly install_directory="$cache_root/gitleaks/v$PINNED_GITLEAKS_VERSION/${platform}_${architecture}"
readonly binary_path="$install_directory/gitleaks"

if [[ -x "$binary_path" ]]; then
  installed_version="$($binary_path version 2>/dev/null || true)"
  if [[ "$installed_version" == *"$PINNED_GITLEAKS_VERSION"* ]]; then
    printf '%s\n' "$binary_path"
    exit 0
  fi
  rm -f "$binary_path"
fi

for required_command in curl tar; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Required command is unavailable: $required_command" >&2
    exit 1
  fi
done

mkdir -p "$install_directory"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

readonly archive_name="gitleaks_${PINNED_GITLEAKS_VERSION}_${platform}_${architecture}.tar.gz"
readonly archive_path="$temporary_directory/$archive_name"
readonly download_url="https://github.com/gitleaks/gitleaks/releases/download/v${PINNED_GITLEAKS_VERSION}/${archive_name}"

curl --fail --location --silent --show-error --retry 3 \
  --output "$archive_path" "$download_url"

if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "$archive_path" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual_checksum="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
else
  echo 'No SHA-256 verification command is available.' >&2
  exit 1
fi

if [[ "$actual_checksum" != "$expected_checksum" ]]; then
  echo 'Gitleaks archive checksum verification failed.' >&2
  exit 1
fi

tar -xzf "$archive_path" -C "$temporary_directory" gitleaks
install -m 0755 "$temporary_directory/gitleaks" "$binary_path"

installed_version="$($binary_path version 2>/dev/null || true)"
if [[ "$installed_version" != *"$PINNED_GITLEAKS_VERSION"* ]]; then
  echo 'Installed Gitleaks binary did not report the pinned version.' >&2
  exit 1
fi

printf '%s\n' "$binary_path"
