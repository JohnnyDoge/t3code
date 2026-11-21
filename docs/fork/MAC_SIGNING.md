# macOS signing and first install

Generate the release identity once with `scripts/fork/make-mac-signing-cert.sh <out-dir>`.
Store `cert.p12.base64` and `password.txt` as `FORK_MAC_CERT_P12_BASE64` and
`FORK_MAC_CERT_PASSWORD` in the `JohnnyDoge/t3code-fork-releases` Actions secrets.
Keep a secure backup of the original identity. A new certificate
with the same common name still changes the update requirement.

The fork build uses electron-builder and the upstream nested signing hook. During signing it
adds a temporary keychain to the search list so Apple’s `codesign` can resolve the self-signed
certificate and removes the keychain after signing. The hook reads the credentials from a
private temporary file, and the build wrapper removes it on exit. The temporary keychain was sufficient on macOS
26.2 without changing certificate trust. The build retains hardened runtime, Electron’s normal
signing entitlements, and the upstream camera and microphone entitlements. Apple provisioning
profile entitlements for in-app browser passkeys require an Apple team and are omitted.
Notarization and secure timestamps are disabled.

## First install

Run `scripts/fork/install-mac.sh --dry-run` to validate the latest nightly prerelease.
The script defaults to `JohnnyDoge/t3code-fork-releases`. Use `--repo <owner/repo>` or
`T3CODE_DESKTOP_UPDATE_REPOSITORY` to select a different release repository.
Run it without `--dry-run` to install. The target is
`/Applications/T3 Code Fork (Nightly).app`. The script refuses the official
`/Applications/T3 Code (Nightly).app` path and any existing target with a different
bundle ID. The script reads the release tag from
`update-feed/nightly.json` and verifies the ZIP against `nightly-mac.yml`. Before clearing
quarantine, it checks the unpacked bundle against the fork certificate's pinned leaf SHA-1
(`8AAF3B790302EEBCE7A8931EC62A51E3462798EA`) and, when replacing a fork install, against
the installed bundle's designated requirement. The previous bundle stays beside the target as
`*.app.backup-<date>`. The script then opens the installed bundle. The fork uses
bundle ID `com.t3tools.t3code.fork`, Electron profile
`~/Library/Application Support/t3code-fork`, and T3 state in
`~/.t3-fork/userdata`. An earlier build using the official bundle ID cannot update
in place to this identity. Install the separate fork once.

- **Keychain.** Electron `safeStorage` protects desktop connection secrets and Clerk sign-in
  storage. The fork sets its own Electron app name before it opens credentials, so it uses its
  own Safe Storage item. Sign in and add environments once in the fork. An authorization stored
  for the fork's designated requirement should carry across builds using the same certificate.
  [Apple code-signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements/)
- **Privacy permissions.** macOS checks the app’s designated requirement for permissions such
  as microphone access. The fork may request its own grants for
  files and folders, Automation, screen recording, camera and
  microphone, depending on what the owner uses. Terminals and coding agents can inherit the
  app’s TCC identity. A stable requirement should preserve approvals on later fork updates,
  subject to normal macOS policy and per-permission prompts.
  [Apple code-signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements/)
- **Gatekeeper.** The installer removes quarantine from the verified replacement. That avoids
  the normal quarantined-download first-open path. The certificate does not supply Apple
  notarization, and managed policies or explicit assessments can still reject it.
  [Apple Platform Security](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)

## Update verification

Electron 44.10.1 pins Squirrel.Mac at `fffea30e4a339a7f7d69a3391314b72548d209bd`. ShipIt
reads the installed bundle's designated requirement and validates the replacement against it,
including nested code and every architecture. `verify-mac-update-signature.sh` mirrors that
check with `codesign`. [Squirrel.Mac signature verification](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLCodeSignature.m#L95)

The release bundle should have this designated requirement:

```text
designated => identifier "com.t3tools.t3code.fork" and certificate leaf = H"8aaf3b790302eebce7a8931ec62a51e3462798ea"
```

The earlier test releases `0.1.12-nightly.20261121.9001` and `0.1.12-nightly.20261121.9002`
proved that Squirrel.Mac accepts successive signatures from one self-signed certificate and
rejects an ad-hoc replacement. Those releases used the previous app ID. Use two builds with
the new ID to verify the separate fork with `verify-mac-update-signature.sh`. For a test-signed
local release, use `--dry-run --test-signer-sha <test certificate SHA-1>` and set
`FORK_MAC_RELEASE_DIR` to its artifacts directory.

Use a separate macOS user session or VM for in-app update tests. ShipIt derives its launchd
service and update-state location from the bundle ID. Scratch builds with the fork's bundle
ID share that service with any fork already installed in the same user session.
[ShipIt launchd job](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLShipItLauncher.m#L25)
