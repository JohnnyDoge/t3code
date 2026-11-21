import * as NodePath from "@effect/platform-node/NodePath";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { renderCliShim } from "../app/DesktopCliShim.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { resolveUserDataPath } from "../app/DesktopUserData.ts";
import {
  forkDesktop,
  isForkDesktopPackage,
  resolveForkWslHome,
  toOfficialLink,
} from "./identity.ts";

it("recognizes only the packaged fork", () => {
  assert.isTrue(isForkDesktopPackage(true, forkDesktop.productName));
  assert.isFalse(isForkDesktopPackage(false, forkDesktop.productName));
  assert.isFalse(isForkDesktopPackage(true, "T3 Code (Nightly)"));
});

it.effect.each([
  { scratchParent: undefined, baseDir: "/Users/alice/.t3-fork" },
  { scratchParent: "/tmp/release-check", baseDir: "/tmp/release-check/.t3-fork" },
  { scratchParent: "relative-directory", baseDir: "/Users/alice/.t3-fork" },
])("isolates the backend home with scratch parent $scratchParent", ({ scratchParent, baseDir }) =>
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    assert.equal(environment.baseDir, baseDir);
    assert.equal(environment.stateDir, `${baseDir}/userdata`);
    assert.equal(environment.logDir, `${baseDir}/userdata/logs`);
    assert.isTrue(Option.isNone(environment.configuredBackendPort));
    assert.isTrue(Option.isNone(environment.devServerUrl));
    assert.deepEqual(environment.branding, {
      baseName: "T3 Code Fork",
      stageLabel: "Nightly",
      displayName: "T3 Code Fork (Nightly)",
    });
    assert.equal(environment.appUserModelId, "com.t3tools.t3code.fork");
  }).pipe(
    Effect.provide(
      DesktopEnvironment.layer({
        dirname: "/install/dist-electron",
        homeDirectory: "/Users/alice",
        platform: "darwin",
        processArch: "arm64",
        appVersion: "0.1.12-nightly.20261121.1",
        appPath: "/install/app.asar",
        isPackaged: true,
        isFork: true,
        resourcesPath: "/install",
        runningUnderArm64Translation: false,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            NodePath.layerPosix,
            DesktopConfig.layerTest({
              T3CODE_HOME: "/Users/alice/.t3",
              T3CODE_PORT: "3773",
              VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
              T3CODE_DESKTOP_APP_USER_MODEL_ID: "com.t3tools.t3code",
              T3CODE_FORK_SCRATCH_PARENT: scratchParent,
            }),
          ),
        ),
      ),
    ),
  ),
);

it.effect("resolves the fork profile without consulting Windows legacy state", () =>
  resolveUserDataPath({
    appDataDirectory: "C:\\Users\\Alice\\AppData\\Roaming",
    isDevelopment: false,
    platform: "win32",
    isFork: true,
  }).pipe(
    Effect.tap((profile) =>
      Effect.sync(() => assert.equal(profile, "C:\\Users\\Alice\\AppData\\Roaming\\t3code-fork")),
    ),
    Effect.provide(NodePath.layerWin32),
    Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
  ),
);

it("derives a Linux-native fork home only from an absolute WSL user home", () => {
  assert.equal(resolveForkWslHome("/home/alice/"), "/home/alice/.t3-fork");
  assert.isUndefined(resolveForkWslHome(undefined));
  assert.isUndefined(resolveForkWslHome("relative-directory"));
});

it("normalizes only the fork scheme for stock auth link parsing", () => {
  const forkLink = "t3code-fork://auth/codex?request=value";
  assert.equal(toOfficialLink(forkLink, true), "t3code://auth/codex?request=value");
  assert.equal(toOfficialLink(forkLink, false), forkLink);
  assert.equal(toOfficialLink("https://example.com", true), "https://example.com");
});

it("sets the fork CLI home even if an official T3CODE_HOME is already defined", () => {
  assert.include(
    renderCliShim({
      target: { kind: "direct", executable: "/install/fork", entry: "/install/bin.mjs" },
      shimPath: "/Users/alice/.t3-fork/bin/t3",
      t3Home: "/Users/alice/.t3-fork",
      forceT3Home: true,
    }),
    'export T3CODE_HOME="$home"',
  );
  assert.include(
    renderCliShim({
      target: { kind: "windows", executable: "C:\\app.exe", entry: "C:\\bin.mjs" },
      shimPath: "C:\\.t3-fork\\bin\\t3.cmd",
      t3Home: "C:\\.t3-fork",
      forceT3Home: true,
    }).split("\r\n"),
    'set "T3CODE_HOME=C:\\.t3-fork"',
  );
});
