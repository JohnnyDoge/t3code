// @effect-diagnostics nodeBuiltinImport:off - Runs the shell sync against local Git repositories.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

const baseTag = "v0.1.11-nightly.20261120.9";
const firstTag = "v0.1.11-nightly.20261120.10";
const conflictTag = "v0.1.12-nightly.20261120.11";
const nextTag = "v0.1.12-nightly.20261120.12";
const lastTag = "v0.1.12-nightly.20261120.13";

function fixture(root: string) {
  const upstream = NodePath.join(root, "upstream.git");
  const origin = NodePath.join(root, "origin.git");
  const repo = NodePath.join(root, "fork");
  const bin = NodePath.join(root, "bin");
  const trace = NodePath.join(root, "trace");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
    GIT_AUTHOR_NAME: "Fork Tests",
    GIT_AUTHOR_EMAIL: "fork@example.test",
    GIT_COMMITTER_NAME: "Fork Tests",
    GIT_COMMITTER_EMAIL: "fork@example.test",
    PATH: bin + NodePath.delimiter + process.env.PATH,
    SYNC_TRACE: trace,
  };
  function git(...args: string[]) {
    return NodeChildProcess.execFileSync("git", args, { cwd: repo, encoding: "utf8", env }).trim();
  }
  function write(path: string, contents: string, executable = false) {
    NodeFS.writeFileSync(NodePath.resolve(repo, path), contents, {
      mode: executable ? 0o755 : 0o644,
    });
  }
  function commit(message: string) {
    git("add", ".");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  }
  function sync(mode?: "--resume" | "--abort") {
    const args = mode ? ["-s", "--", mode] : ["scripts/fork/sync-upstream.sh"];
    const shell = process.platform === "win32" ? "bash" : "/bin/bash";
    const result = NodeChildProcess.spawnSync(shell, args, {
      cwd: repo,
      encoding: "utf8",
      env,
      ...(mode && { input: git("show", "main:scripts/fork/sync-upstream.sh") }),
    });
    if (result.error) throw result.error;
    return { ...result, lastLine: result.stdout.trim().split("\n").at(-1) };
  }

  NodeFS.mkdirSync(repo);
  NodeFS.mkdirSync(bin);
  git("init", "-q", "-b", "main");
  write("seam.ts", 'const value = "original";\n');
  write("version.txt", baseTag + "\n");
  const baseSha = commit("Upstream base");
  git("tag", baseTag);
  let lastSha = baseSha;
  for (const tag of [firstTag, conflictTag, nextTag, lastTag]) {
    if (tag === conflictTag) write("seam.ts", 'const value = "upstream";\n');
    write("version.txt", tag + "\n");
    lastSha = commit(tag);
    git("tag", tag);
  }
  git("clone", "-q", "--bare", ".", upstream);
  git("reset", "--hard", baseSha);
  NodeFS.mkdirSync(NodePath.join(repo, "scripts/fork"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(repo, "docs/fork"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(repo, "apps/web/src"), { recursive: true });
  for (const script of ["sync-upstream.sh", "upstream-base.sh", "check-seams.sh"]) {
    NodeFS.copyFileSync(
      new URL("./" + script, import.meta.url),
      NodePath.join(repo, "scripts/fork", script),
    );
  }
  write(
    "scripts/fork/check-routes.sh",
    `#!/bin/bash
set -eu
case \${1:-} in
  --upstream) git cat-file -e "$2^{commit}" ;;
  --generate)
    [ ! -e "$SYNC_TRACE.fail-generation" ] || exit 1
    printf 'generated %s\\n' "$(cat version.txt)" | tee apps/web/src/routeTree.gen.ts >> "$SYNC_TRACE" ;;
  "") grep -Fx "generated $(cat version.txt)" apps/web/src/routeTree.gen.ts ;;
esac
`,
  );
  write("docs/fork/UPSTREAM_BASE", `${baseTag} ${baseSha}\n`);
  write("docs/fork/FORK.md", "## 6. Seam registry\n\n| `seam.ts` | Test seam |\n");
  write("apps/web/src/routeTree.gen.ts", `generated ${baseTag}\n`);
  write("seam.ts", 'const value = "fork"; // fork(board)\n');
  const original = commit("Fork seam");
  git("clone", "-q", "--bare", ".", origin);
  git("remote", "add", "upstream", upstream);
  git("remote", "add", "origin", origin);
  write(
    NodePath.join(origin, "hooks/pre-receive"),
    '#!/bin/sh\ncat >/dev/null\necho push >> "$SYNC_TRACE"\n',
    true,
  );
  write(NodePath.join(bin, "vp"), '#!/bin/sh\necho "vp $*" >> "$SYNC_TRACE"\n', true);
  write(NodePath.join(bin, "node"), "#!/bin/sh\nexit 0\n", true);
  return {
    git,
    readTrace: () => NodeFS.readFileSync(trace, "utf8").trim().split("\n"),
    sync,
    write,
    baseSha,
    lastSha,
    original,
    origin,
    upstream,
  };
}

it("replays nightlies in version order and resumes the saved plan after a middle conflict", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-sync-test-"));
  try {
    const { git, readTrace, sync, write, lastSha, original, origin, upstream } = fixture(root);
    const paused = sync();
    expect(paused.lastLine, paused.stderr).toBe(`conflict ${conflictTag} seam.ts`);
    expect(paused.status).toBe(2);
    expect(git("rev-parse", "main")).toBe(original);
    expect(git("--git-dir", origin, "rev-parse", "main")).toBe(original);
    expect(git("show", `sync/${lastTag}:docs/fork/UPSTREAM_BASE`)).toMatch(
      new RegExp(`^${firstTag.replaceAll(".", "\\.")} [0-9a-f]{40}$`),
    );
    expect(readTrace()).toEqual(["vp i", `generated ${firstTag}`]);

    git("--git-dir", upstream, "tag", "v0.1.12-nightly.20261120.14", lastSha);
    write("seam.ts", 'const value = "upstream and fork"; // fork(board)\n');
    git("add", "seam.ts");
    const generationFailure = NodePath.join(root, "trace.fail-generation");
    write(generationFailure, "");
    const interrupted = sync("--resume");
    expect(interrupted.lastLine, interrupted.stderr).toBe(
      `check-failed generate-routes ${conflictTag}`,
    );
    expect(interrupted.status).toBe(3);
    expect(git("branch", "--show-current")).toBe(`sync/${lastTag}`);
    NodeFS.rmSync(generationFailure);

    const resumed = sync("--resume");
    expect(resumed.lastLine, resumed.stderr).toBe(`pushed ${lastTag}`);
    expect(resumed.status).toBe(0);
    expect(readTrace()).toEqual([
      "vp i",
      `generated ${firstTag}`,
      "vp i",
      "vp i",
      `generated ${conflictTag}`,
      `generated ${nextTag}`,
      `generated ${lastTag}`,
      "vp test run src/fork src/components/threadActionMenu.logic.test.ts",
      "vp test run packages/client-runtime/src/state/threadCommands.test.ts",
      "vp test run scripts/fork/*.test.ts",
      "vp run --filter @t3tools/web typecheck",
      "vp run --filter @t3tools/client-runtime typecheck",
      "vp run --filter @t3tools/desktop typecheck",
      "push",
    ]);
    expect(git("show", "main:docs/fork/UPSTREAM_BASE")).toBe(`${lastTag} ${lastSha}`);
    expect(git("rev-parse", "main")).toBe(git("--git-dir", origin, "rev-parse", "main"));
    expect(git("log", "--format=%s", `${lastSha}..main`)).toBe(
      `chore(fork): sync with upstream ${lastTag}\nFork seam`,
    );
    expect(git("branch", "--list")).toBe("* main");
    expect(git("status", "--porcelain")).toBe("");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

it("rejects an intermediate tag that regresses even when the newest tag is valid", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-sync-test-"));
  try {
    const { git, sync, baseSha, lastSha, original, upstream } = fixture(root);
    git("--git-dir", upstream, "tag", "-f", baseTag, lastSha);
    const moved = sync();
    expect(moved.lastLine, moved.stderr).toBe(
      `error accepted upstream tag ${baseTag} moved from ${baseSha} to ${lastSha}`,
    );
    expect(moved.status).toBe(1);

    git("--git-dir", upstream, "tag", "-f", baseTag, baseSha);
    git("--git-dir", upstream, "tag", "-f", conflictTag, baseSha);
    const regressed = sync();
    expect(regressed.lastLine, regressed.stderr).toBe(
      `error upstream tag ${conflictTag} regressed from ${firstTag}`,
    );
    expect(regressed.status).toBe(1);
    expect(git("rev-parse", "HEAD")).toBe(original);
    expect(git("branch", "--list")).toBe("* main");
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
