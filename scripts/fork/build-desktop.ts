#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - The macOS signing hook runs inside electron-builder.

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import type { SignOptions } from "@electron/osx-sign";
import Plist from "plist";

const identity = "T3 Code Fork Signing";

export const forkMacSigningBuildConfig = {
  // The explicit ad-hoc selector enters the custom hook without a trusted identity.
  identity: "-",
  forceCodeSigning: true,
  notarize: false,
  sign: NodeURL.fileURLToPath(import.meta.url),
} as const;

function security(...args: ReadonlyArray<string>): string {
  const result = NodeChildProcess.spawnSync("/usr/bin/security", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(`security ${args[0]} failed`, { cause: result.error });
  }
  return result.stdout;
}

function signingCredentials() {
  const base64 = process.env.FORK_MAC_CERT_P12_BASE64?.trim();
  const password = process.env.FORK_MAC_CERT_PASSWORD;
  if (!base64 || !password) {
    throw new Error("Set FORK_MAC_CERT_P12_BASE64 and FORK_MAC_CERT_PASSWORD for macOS builds.");
  }
  return { base64, password };
}

function userKeychains() {
  return Array.from(
    security("list-keychains", "-d", "user").matchAll(/^\s*"(.+)"\s*$/gm),
    (match) => match[1]!,
  );
}

export default async function signForkMac(options: SignOptions) {
  const credentials = signingCredentials();
  const originalKeychains = userKeychains();
  const directory = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fork-signing-")),
  );
  const keychain = NodePath.join(directory, "signing.keychain-db");
  const keychainPassword = NodeCrypto.randomBytes(32).toString("hex");
  let keychainCreated = false;

  function cleanup() {
    if (keychainCreated) {
      security("delete-keychain", keychain);
      keychainCreated = false;
    }
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }

  const signals = [
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const;
  const signalHandlers = signals.map(([signal, exitCode]) => {
    const handler = () => {
      try {
        cleanup();
      } finally {
        process.exit(exitCode);
      }
    };
    process.prependListener(signal, handler);
    return [signal, handler] as const;
  });

  try {
    const certificate = NodePath.join(directory, "cert.p12");
    NodeFS.writeFileSync(certificate, Buffer.from(credentials.base64, "base64"), { mode: 0o600 });
    security("create-keychain", "-p", keychainPassword, keychain);
    keychainCreated = true;
    // codesign also consults the search list to build the certificate chain.
    security("list-keychains", "-d", "user", "-s", keychain, ...originalKeychains);
    security("unlock-keychain", "-p", keychainPassword, keychain);
    security(
      "import",
      certificate,
      "-k",
      keychain,
      "-P",
      credentials.password,
      "-T",
      "/usr/bin/codesign",
    );
    security(
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      keychainPassword,
      keychain,
    );
    NodeFS.rmSync(certificate);

    const appEntitlements = options.optionsForFile?.(options.app, { platform: "darwin" });
    if (typeof appEntitlements?.entitlements !== "string") {
      throw new Error("electron-builder did not provide macOS app entitlements.");
    }
    const entitlementsPath = NodePath.join(directory, "entitlements.plist");
    NodeFS.writeFileSync(
      entitlementsPath,
      Plist.build({
        ...(Plist.parse(
          NodeFS.readFileSync(appEntitlements.entitlements, "utf8"),
        ) as Plist.PlistObject),
        "com.apple.security.device.camera": true,
        "com.apple.security.device.audio-input": true,
      }),
    );
    const { default: signApplication } = await import("../sign-macos.ts");
    await signApplication({
      ...options,
      identity,
      keychain,
      identityValidation: false,
      preAutoEntitlements: false,
      optionsForFile: (file, context) => ({
        ...options.optionsForFile?.(file, context),
        timestamp: "none",
        ...(file === options.app ? { entitlements: entitlementsPath } : {}),
      }),
    });
  } finally {
    try {
      cleanup();
    } finally {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
    }
  }
}

async function main() {
  const { values } = NodeUtil.parseArgs({
    options: {
      platform: { type: "string" },
      arch: { type: "string" },
      version: { type: "string" },
      out: { type: "string" },
    },
  });
  const { platform, arch, version, out } = values;
  const mac = platform === "mac" && (arch === "arm64" || arch === "x64");
  if (
    (!mac && !(platform === "win" && arch === "x64")) ||
    !version ||
    !/^\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/.test(version) ||
    !out
  ) {
    throw new Error(
      "Usage: build-desktop.ts --platform <mac|win> --arch <arm64|x64> --version <nightly-version> --out <dir>",
    );
  }
  const repository = process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY?.trim();
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error("Set T3CODE_DESKTOP_UPDATE_REPOSITORY to the fork's owner/repo.");
  }
  if (mac) {
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone build wrapper runs before Effect starts.
    if (process.platform !== "darwin")
      throw new Error("macOS signing requires a macOS build host.");
    signingCredentials();
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    T3CODE_DESKTOP_UPDATE_REPOSITORY: repository,
    T3CODE_DESKTOP_SIGNED: String(mac),
    T3CODE_FORK_MAC_SIGNING: String(mac),
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  };
  delete env.CSC_LINK;
  delete env.CSC_KEY_PASSWORD;
  delete env.CSC_KEYCHAIN;
  delete env.CSC_NAME;
  delete env.WIN_CSC_LINK;
  delete env.WIN_CSC_KEY_PASSWORD;
  const child = NodeChildProcess.spawn(
    process.execPath,
    [
      NodeURL.fileURLToPath(new URL("../build-desktop-artifact.ts", import.meta.url)),
      "--platform",
      platform,
      "--arch",
      arch,
      "--target",
      mac ? "dmg" : "nsis",
      "--build-version",
      version,
      "--output-dir",
      NodePath.resolve(out),
    ],
    { env, stdio: "inherit" },
  );
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
