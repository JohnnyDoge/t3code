import * as NodePath from "@effect/platform-node/NodePath";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { createBuildConfig } from "../build-desktop-artifact.ts";

it.effect.each([
  { platform: "mac", target: "dmg" },
  { platform: "win", target: "nsis" },
] as const)(
  "packages a separate $platform application using the existing nightly update feed",
  ({ platform, target }) =>
    Effect.gen(function* () {
      const makeConfig = createBuildConfig(
        platform,
        target,
        "0.1.12-nightly.20261121.9100",
        false,
        false,
        undefined,
        undefined,
      );
      const official = yield* makeConfig;
      const fork = yield* makeConfig.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                T3CODE_FORK_DESKTOP: "true",
                T3CODE_DESKTOP_UPDATE_REPOSITORY: "JohnnyDoge/t3code-fork-releases",
              },
            }),
          ),
        ),
      );
      assert.equal(official.appId, "com.t3tools.t3code");
      assert.equal(official.productName, "T3 Code (Nightly)");
      assert.equal(fork.appId, "com.t3tools.t3code.fork");
      assert.equal(fork.productName, "T3 Code Fork (Nightly)");
      assert.deepStrictEqual(fork.extraMetadata, { productName: "T3 Code Fork (Nightly)" });
      assert.equal(fork.artifactName, official.artifactName);
      assert.deepNestedPropertyVal(fork, platform === "mac" ? "mac.protocols[0]" : "protocols[0]", {
        name: "T3 Code Fork (Nightly)",
        schemes: ["t3code-fork"],
      });
      assert.deepStrictEqual(fork.publish, [
        {
          provider: "github",
          owner: "JohnnyDoge",
          repo: "t3code-fork-releases",
          releaseType: "prerelease",
          channel: "nightly",
        },
      ]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(NodePath.layer, ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
      ),
    ),
);
