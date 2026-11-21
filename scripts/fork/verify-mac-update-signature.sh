#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 2 || ! -d "$1" || ! -d "$2" ]]; then
  printf 'Usage: %s <old.app> <new.app>\n' "$0" >&2
  exit 2
fi

old_app=$(cd "$1" && pwd -P)
new_app=$(cd "$2" && pwd -P)
bundle_id=com.t3tools.t3code.fork
for app in "$old_app" "$new_app"; do
  identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")
  if [[ $identifier != "$bundle_id" ]]; then
    printf 'Expected bundle identifier %s at %s\n' "$bundle_id" "$app" >&2
    exit 1
  fi
done
old_signature=$(/usr/bin/codesign -d -r- "$old_app" 2>&1)
requirement=$(sed -n 's/^designated => //p' <<< "$old_signature")
if [[ -z "$requirement" ]]; then
  printf 'No designated requirement found for %s\n' "$old_app" >&2
  exit 1
fi

# Squirrel.Mac checks the installed bundle's requirement, including all nested code and architectures.
/usr/bin/codesign --verify --deep --strict --all-architectures --verbose=2 -R "=$requirement" "$new_app"
