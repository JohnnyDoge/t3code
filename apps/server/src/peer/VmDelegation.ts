// fork(board): Load the root-owned grant for the designated Hyper-V guest.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- O_NOFOLLOW and metadata from the opened descriptor are needed for the administrator grant.
import { constants, lstat, open, readFile } from "node:fs/promises";
import { EnvironmentId, ProjectId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const header = "t3-vm-full-access-delegation";

const directory = "/etc/t3code";
const file = `${directory}/vm-delegation.json`;
const maxBytes = 4096;

const sourceGrant = Schema.Struct({
  sourceEnvironmentId: EnvironmentId,
  sourceSessionId: TrimmedNonEmptyString,
});

const guestGrant = {
  machineId: Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/u)),
  environmentId: EnvironmentId,
  projectId: ProjectId,
};

const grantSchema = Schema.Union([
  Schema.Struct({ ...guestGrant, sources: Schema.NonEmptyArray(sourceGrant) }),
  Schema.Struct({ ...guestGrant, ...sourceGrant.fields }),
]);

export type Grant = typeof grantSchema.Type;

export function permitsSource(
  grant: Grant,
  environmentId: EnvironmentId | undefined,
  sessionId: string | undefined,
): boolean {
  const sources = "sources" in grant ? grant.sources : [grant];
  return sources.some(
    (source) =>
      source.sourceEnvironmentId === environmentId && source.sourceSessionId === sessionId,
  );
}

const decodeGrant = Schema.decodeUnknownSync(Schema.fromJsonString(grantSchema), {
  onExcessProperty: "error",
});

async function readGrant(): Promise<Grant | undefined> {
  if (process.platform !== "linux") return undefined;

  const [directoryInfo, vendor, product, machineId] = await Promise.all([
    lstat(directory),
    readFile("/sys/class/dmi/id/sys_vendor", "utf8"),
    readFile("/sys/class/dmi/id/product_name", "utf8"),
    readFile("/etc/machine-id", "utf8"),
  ]);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.uid !== 0 ||
    (directoryInfo.mode & 0o022) !== 0 ||
    vendor.trim() !== "Microsoft Corporation" ||
    product.trim() !== "Virtual Machine"
  )
    return undefined;

  // The file and its parent are controlled by the guest administrator.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022) !== 0 || info.size > maxBytes)
      return undefined;
    const grant = decodeGrant(await handle.readFile("utf8"));
    return grant.machineId === machineId.trim() ? grant : undefined;
  } finally {
    await handle.close();
  }
}

// Read on explicit delegation so removal revokes new launches immediately.
export const LoadGrant = Context.Reference<Effect.Effect<Grant | undefined>>(
  "t3/peer/VmDelegation/LoadGrant",
  {
    defaultValue: () => Effect.promise(() => readGrant().catch(() => undefined)),
  },
);
