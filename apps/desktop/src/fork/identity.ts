import forkDesktop from "../../../../scripts/fork/desktop-identity.json" with { type: "json" };

export { forkDesktop };

export function isForkDesktopPackage(isPackaged: boolean, appName: string): boolean {
  return isPackaged && appName === forkDesktop.productName;
}

export function resolveForkHome(
  homeDirectory: string,
  scratchParent: string | undefined,
  path: Pick<typeof import("node:path"), "isAbsolute" | "join">,
): string {
  const parent = scratchParent && path.isAbsolute(scratchParent) ? scratchParent : homeDirectory;
  return path.join(parent, forkDesktop.homeName);
}

export function toOfficialLink(value: string | undefined, isFork: boolean | undefined) {
  return isFork ? value?.replace(/^t3code-fork:/i, "t3code:") : value;
}

export function resolveForkWslHome(homeDirectory: string | undefined): string | undefined {
  return homeDirectory?.startsWith("/")
    ? `${homeDirectory.replace(/\/+$/, "")}/${forkDesktop.homeName}`
    : undefined;
}
