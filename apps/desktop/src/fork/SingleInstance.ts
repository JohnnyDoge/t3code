import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Electron from "electron";
import { msg } from "gt-i18n";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import { m } from "../i18n/messages.ts";

export const layerWithForkInstanceFeedback = Layer.effect(
  ElectronApp.ElectronApp,
  Effect.gen(function* () {
    const app = yield* ElectronApp.ElectronApp;
    const dialog = yield* ElectronDialog.ElectronDialog;
    yield* app.on("second-instance", () => {
      // On macOS the app can stay open after its last window closes.
      if (Electron.BrowserWindow.getAllWindows().length === 0) {
        Electron.app.focus({ steal: true });
      }
    });
    return {
      ...app,
      requestSingleInstanceLock: app.requestSingleInstanceLock.pipe(
        Effect.tap((acquired) =>
          acquired
            ? Effect.void
            : dialog.showErrorBox(
                m(msg("T3 Code is already running")),
                m(msg("Quit the running T3 Code app before opening another copy.")),
              ),
        ),
      ),
    };
  }),
).pipe(Layer.provide(Layer.mergeAll(ElectronApp.layer, ElectronDialog.layer)));
