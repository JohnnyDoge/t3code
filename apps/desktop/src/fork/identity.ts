import type { App } from "electron";

import forkDesktop from "../../../../scripts/fork/desktop-identity.json" with { type: "json" };

export { forkDesktop };

export function configureForkDesktopApp(app: Pick<App, "isPackaged" | "getName" | "setName">) {
  if (!app.isPackaged || app.getName() !== forkDesktop.packageName) return false;
  // Electron uses the early app name for the Windows singleton mutex and macOS Safe Storage key.
  app.setName(forkDesktop.sharedRuntimeName);
  return true;
}
