#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

official_target='/Applications/T3 Code (Nightly).app'
target='/Applications/T3 Code Fork (Nightly).app'
repo=${T3CODE_DESKTOP_UPDATE_REPOSITORY:-JohnnyDoge/t3code-fork-releases}
dry_run=false
fork_cert_sha=8AAF3B790302EEBCE7A8931EC62A51E3462798EA
signer_sha=$fork_cert_sha
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) [[ $# -ge 2 && -n "$2" ]] || fail '--target requires a path'; target=$2; shift ;;
    --repo) [[ $# -ge 2 && -n "$2" ]] || fail '--repo requires owner/repo'; repo=$2; shift ;;
    --dry-run) dry_run=true ;;
    --test-signer-sha)
      [[ $# -ge 2 && $2 =~ ^[[:xdigit:]]{40}$ ]] || fail '--test-signer-sha requires a SHA-1 fingerprint'
      signer_sha=$2
      shift
      ;;
    *) fail "Usage: $0 [--target <path to .app>] [--repo owner/repo] [--dry-run [--test-signer-sha <sha1>]]" ;;
  esac
  shift
done

[[ "$signer_sha" = "$fork_cert_sha" ]] || "$dry_run" || fail '--test-signer-sha requires --dry-run'
[[ "$(uname -s)" = Darwin ]] || fail 'The installer requires macOS.'
[[ "$target" = *.app ]] || fail 'The target must be a .app bundle.'
[[ "$target" = /* ]] || target="$PWD/$target"
parent=$(cd "$(dirname "$target")" && pwd -P)
target="$parent/${target##*/}"
[[ "$target" != "$official_target" ]] || fail "Refusing the official T3 Code app path."
bundle_id=com.t3tools.t3code.fork
installed_requirement=
if [[ -e "$target" || -L "$target" ]]; then
  [[ ! -L "$target" && -d "$target" ]] || fail "Refusing to replace a symlink or non-bundle at $target"
  old_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$target/Contents/Info.plist")
  [[ "$old_id" = "$bundle_id" ]] || fail "Unexpected bundle identifier at $target"
  installed_signature=$(/usr/bin/codesign -d -r- "$target" 2>&1)
  installed_requirement=$(sed -n 's/^designated => //p' <<< "$installed_signature")
  [[ -n "$installed_requirement" ]] || fail "Missing designated requirement for the installed fork."
fi

if "$dry_run"; then
  work_dir=$(mktemp -d "${TMPDIR:-/tmp}/t3-fork-install.XXXXXXXX")
else
  work_dir=$(mktemp -d "$parent/.t3-fork-install.XXXXXXXX")
fi
trap 'rm -rf "$work_dir"' EXIT
trap 'exit 1' HUP INT TERM

fetch_public() {
  curl --fail --silent --show-error --location --proto '=https' --retry 2 "$@"
}

metadata=nightly-mac.yml
local_release=${FORK_MAC_RELEASE_DIR:-}
if [[ -n "$local_release" ]]; then
  [[ "$local_release" = /* ]] || local_release="$PWD/$local_release"
  cp "$local_release/$metadata" "$work_dir/$metadata"
else
  [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'Set --repo to the public release repository owner/repo.'
  fetch_public "https://github.com/$repo/releases/download/update-feed/nightly.json" \
    --output "$work_dir/nightly.json"
  tag=$(/usr/bin/ruby -rjson -e '
    tag = JSON.parse(File.read(ARGV[0])).fetch("tag_name")
    abort "Invalid nightly tag in the fork update feed." unless tag.match?(/\Av\d+\.\d+\.\d+-nightly\.\d{8}\.\d+\z/)
    puts tag
  ' "$work_dir/nightly.json")
  release_url="https://github.com/$repo/releases/download/$tag"
  fetch_public "$release_url/$metadata" --output "$work_dir/$metadata"
fi

selection=$(/usr/bin/ruby -ryaml -e '
  metadata = YAML.safe_load(File.read(ARGV[0]), permitted_classes: [Time])
  version = metadata.fetch("version")
  abort "Invalid nightly update version." unless version.match?(/\A\d+\.\d+\.\d+-nightly\.\d{8}\.\d+\z/)
  abort "Release tag and update metadata versions differ." unless ARGV[2].empty? || ARGV[2].sub(/\Av/, "") == version
  archive = metadata.fetch("files").select do |file|
    file.fetch("url").match?(/\A[A-Za-z0-9_.-]+-#{Regexp.escape(ARGV[1])}\.zip\z/)
  end
  abort "Expected one #{ARGV[1]} zip in the macOS update metadata." unless archive.size == 1
  zip = archive.first
  digest = zip.fetch("sha512")
  abort "Invalid SHA-512 in the update metadata." unless digest.match?(%r{\A[A-Za-z0-9+/]{86}==\z})
  puts [zip.fetch("url"), digest, version].join(" ")
' "$work_dir/$metadata" "$(uname -m | sed 's/^x86_64$/x64/')" "${tag:-}")
read -r zip_name expected_sha version <<< "$selection"

if [[ -n "$local_release" ]]; then
  cp "$local_release/$zip_name" "$work_dir/$zip_name"
else
  fetch_public "$release_url/$zip_name" --output "$work_dir/$zip_name"
fi
actual_sha=$(/usr/bin/openssl dgst -sha512 -binary "$work_dir/$zip_name" | /usr/bin/openssl base64 -A)
[[ "$actual_sha" = "$expected_sha" ]] || fail "SHA-512 mismatch for $zip_name"

unpacked="$work_dir/unpacked"
/usr/bin/ditto -x -k --noqtn "$work_dir/$zip_name" "$unpacked"
apps=("$unpacked"/*.app)
app=${apps[0]}
[[ ${#apps[@]} = 1 && -d "$app" && ! -L "$app" ]] || fail 'Expected one app bundle in the zip.'
new_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")
new_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")
[[ "$new_id" = "$bundle_id" && "$new_version" = "$version" ]] || fail 'The app identity or version does not match the release.'
verify_requirement() {
  /usr/bin/codesign --verify --deep --strict --all-architectures -R "=$1" "$app"
}

verify_requirement "identifier \"$bundle_id\" and certificate leaf = H\"$signer_sha\"" ||
  fail "The app does not satisfy the fork signer pin ($signer_sha)."
if [[ -n $installed_requirement ]]; then
  verify_requirement "$installed_requirement" || fail "The app does not satisfy the installed fork's designated requirement."
fi
if ! /usr/bin/xattr -dr com.apple.quarantine "$app" 2>/dev/null; then
  attributes=$(/usr/bin/xattr -r "$app")
  [[ "$attributes" != *com.apple.quarantine* ]] || fail 'Could not remove quarantine from the app.'
fi

backup="$target.backup-$(date -u +%Y%m%dT%H%M%SZ)-${work_dir##*.}"
if "$dry_run"; then
  printf 'Verified %s (SHA-512 and code signature). Would quit %s, install %s, keep any existing bundle at %s, and relaunch.\n' \
    "$zip_name" "$target" "$version" "$backup"
  exit 0
fi

/usr/bin/osascript -l JavaScript - "$target" "$bundle_id" <<'JXA'
ObjC.import("AppKit");
function run(args) {
  const running = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(args[1]);
  const target = $.NSURL.fileURLWithPath(args[0]).URLByResolvingSymlinksInPath.path.js;
  const matches = [];
  for (let i = 0; i < running.count; i++) {
    const app = running.objectAtIndex(i);
    const bundle = app.bundleURL;
    if (bundle && ObjC.unwrap(bundle.URLByResolvingSymlinksInPath.path) === target) {
      matches.push(app);
    }
  }
  for (const app of matches) {
    if (!app.isTerminated && !app.terminate) throw Error("Could not request quit for " + target);
  }
  const deadline = Date.now() + 30000;
  while (matches.some((app) => !app.isTerminated)) {
    if (Date.now() >= deadline) throw Error("Timed out waiting for " + target + " to quit.");
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.25));
  }
}
JXA

# Stage the replacement beside the target, then exchange both names in one filesystem operation.
/usr/bin/ruby -rfiddle/import - "$app" "$target" "$backup" <<'RUBY'
module Darwin
  extend Fiddle::Importer
  dlload Fiddle::Handle::DEFAULT
  extern "int renamex_np(const char*, const char*, unsigned int)"
  RENAME_SWAP = 0x00000002
  RENAME_EXCL = 0x00000004

  def self.rename(from, to, flags)
    return if renamex_np(from, to, flags).zero?
    raise SystemCallError.new("rename #{from} to #{to}", Fiddle.last_error)
  end
end

source, target, backup = ARGV
if File.symlink?(target)
  abort "Refusing to replace a symlink at #{target}"
elsif File.exist?(target)
  Darwin.rename(source, backup, Darwin::RENAME_EXCL)
  begin
    Darwin.rename(backup, target, Darwin::RENAME_SWAP)
  rescue SystemCallError
    warn "Replacement remains at #{backup}"
    raise
  end
  puts "Previous bundle kept at #{backup}"
else
  Darwin.rename(source, target, Darwin::RENAME_EXCL)
end
RUBY
/usr/bin/open -n -a "$target"
