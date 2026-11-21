// @effect-diagnostics nodeBuiltinImport:off - Runs the standalone Ruby validator against temporary release fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

const validator = NodeURL.fileURLToPath(new URL("./validate-release.rb", import.meta.url));
const version = "0.1.12-nightly.20261121.9002";

it("validates the complete release and rejects inconsistent or incomplete assets", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-release-test-"));
  try {
    const mac = NodePath.join(root, "fork-desktop-mac");
    const win = NodePath.join(root, "fork-desktop-win");
    NodeFS.mkdirSync(mac);
    NodeFS.mkdirSync(win);

    function createAsset(directory: string, url: string) {
      NodeFS.writeFileSync(NodePath.join(directory, url), url);
      NodeFS.writeFileSync(NodePath.join(directory, url + ".blockmap"), "test blockmap");
      return {
        url,
        size: url.length,
        sha512: NodeCrypto.createHash("sha512").update(url).digest("base64"),
      };
    }

    const zip = createAsset(mac, `T3-Code-${version}-arm64.zip`);
    const dmg = createAsset(mac, `T3-Code-${version}-arm64.dmg`);
    const exe = createAsset(win, `T3-Code-${version}-x64.exe`);
    const macManifest = NodePath.join(mac, "nightly-mac.yml");
    const winManifest = NodePath.join(win, "nightly.yml");
    const macMetadata = { version, files: [zip, dmg], path: zip.url, sha512: zip.sha512 };
    NodeFS.writeFileSync(macManifest, JSON.stringify(macMetadata));
    NodeFS.writeFileSync(
      winManifest,
      JSON.stringify({ version, files: [exe], path: exe.url, sha512: exe.sha512 }),
    );

    const validate = () =>
      NodeChildProcess.spawnSync("ruby", [validator, version, root], { encoding: "utf8" });
    const validated = validate();
    expect(validated.stderr).toBe("");
    expect(validated.status).toBe(0);
    expect(validated.stdout.trim().split("\n")).toHaveLength(8);

    NodeFS.writeFileSync(macManifest, JSON.stringify({ ...macMetadata, version: "0.0.0" }));
    expect(validate().stderr).toContain("nightly-mac.yml expected version");

    NodeFS.writeFileSync(
      macManifest,
      JSON.stringify({ ...macMetadata, files: [zip, { ...dmg, url: "wrong.dmg" }] }),
    );
    expect(validate().stderr).toContain("nightly-mac.yml expected file names");

    NodeFS.writeFileSync(macManifest, JSON.stringify(macMetadata));
    NodeFS.writeFileSync(NodePath.join(mac, dmg.url), "corrupt");
    expect(validate().stderr).toContain(`nightly-mac.yml has a SHA-512 mismatch for ${dmg.url}`);

    NodeFS.writeFileSync(NodePath.join(mac, dmg.url), dmg.url);
    NodeFS.rmSync(NodePath.join(win, exe.url + ".blockmap"));
    expect(validate().stderr).toContain(`Missing or empty blockmap for ${exe.url}`);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
