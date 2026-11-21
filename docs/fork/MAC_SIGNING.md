# macOS signing and first install

Generate the release identity once with `scripts/fork/make-mac-signing-cert.sh <out-dir>`.
Store `cert.p12.base64` and `password.txt` as `FORK_MAC_CERT_P12_BASE64` and
`FORK_MAC_CERT_PASSWORD`. Keep a secure backup of the original identity. A new certificate
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

Run `scripts/fork/install-mac.sh --repo <owner/repo> --dry-run` to validate the latest nightly
prerelease. The repository defaults to `T3CODE_DESKTOP_UPDATE_REPOSITORY` or the checkout’s
GitHub `origin`. Run it without `--dry-run` to install. The default target is
`/Applications/T3 Code (Nightly).app`. The script reads the release tag from
`update-feed/nightly.json` and verifies the ZIP against `nightly-mac.yml`. Before clearing
quarantine, it checks the unpacked bundle against the fork certificate's pinned leaf SHA-1
(`8AAF3B790302EEBCE7A8931EC62A51E3462798EA`) and, when replacing a fork install, against
the installed bundle's designated requirement. The previous bundle stays beside the target as
`*.app.backup-<date>`. The script then opens the installed bundle. The installed app and the fork use
`T3 Code (Nightly)` and bundle ID `com.t3tools.t3code`. The packaged profile resolves to
`~/Library/Application Support/t3code-v2`, and the default T3 state stays in
`~/.t3/userdata`.

- **Keychain.** Electron `safeStorage` protects the desktop connection catalog, saved environment secrets, and Clerk sign-in storage. The official
  app’s existing Keychain item can prompt for access when the signer changes. If access is
  denied, the fork may be unable to decrypt the existing catalog and the owner may need to
  reconnect environments or sign in again. An authorization stored for the fork’s designated
  requirement should carry across builds using the same certificate.
  [Apple code-signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements/)
- **Privacy permissions.** macOS checks the app’s designated requirement for permissions such
  as microphone access. Expect some permissions to need approval again on the switch from
  upstream, potentially including files and folders, Automation, screen recording, camera and
  microphone, depending on what the owner uses. Terminals and coding agents can inherit the
  app’s TCC identity. A stable requirement should preserve approvals on later fork updates,
  subject to normal macOS policy and per-permission prompts.
  [Apple code-signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements/)
- **Gatekeeper.** The installer removes quarantine from the verified replacement. That avoids
  the normal quarantined-download first-open path. The certificate does not supply Apple
  notarization, and managed policies or explicit assessments can still reject it. First launch
  and any prompts remain untested on this Mac.
  [Apple Platform Security](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)

## Update verification

Electron 44.10.1 pins Squirrel.Mac at `fffea30e4a339a7f7d69a3391314b72548d209bd`. ShipIt
reads the installed bundle's designated requirement and validates the replacement against it,
including nested code and every architecture. `verify-mac-update-signature.sh` mirrors that
check with `codesign`. [Squirrel.Mac signature verification](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLCodeSignature.m#L95)

Two arm64 releases, `0.1.12-nightly.20261121.9001` and `0.1.12-nightly.20261121.9002`,
produced DMGs, ZIPs, blockmaps and `nightly-mac.yml` on macOS 26.2. Both ZIPs passed
`codesign --verify --deep --strict --verbose=2` after extraction and had this requirement:

```text
designated => identifier "com.t3tools.t3code" and certificate leaf = H"76e49d5c12c3cf20ed471dbbc1752a8a19371579"
```

The 9002 code directory hash was identical before archiving and after extraction. The
`codesign -R` check accepted 9001 → 9002 and rejected a valid ad-hoc-signed copy. A scratch
probe calling the same Security.framework functions as Squirrel.Mac returned `0` for the
signed update and `-67050` for the ad-hoc copy. Both builds restored the keychain search list.
The installer dry run validated the 9002 release metadata, SHA-512 and signature against
a 9001 scratch target. The retained test release uses a separate certificate. To verify that
release in a dry run, use `--test-signer-sha 76e49d5c12c3cf20ed471dbbc1752a8a19371579`
and set `FORK_MAC_RELEASE_DIR` to the local test release directory.

The in-app test requires a separate macOS user session or VM. The installed and scratch builds
share a bundle ID and ShipIt derives its launchd service and update-state location from that
ID. Separate ports and a different `T3CODE_HOME` do not isolate that service.
[ShipIt launchd job](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLShipItLauncher.m#L25)

A fallback would belong in the desktop `ElectronUpdater` adapter, which receives electron-updater’s
downloaded ZIP and hands off to native `quitAndInstall`. The UI state machine can keep its
existing download and restart states.
