import { describe, expect, it, vi } from "vite-plus/test";

import { configureForkDesktopApp } from "./identity.ts";

describe("configureForkDesktopApp", () => {
  it.each([
    { isPackaged: true, packageName: "t3code-fork", expectedName: "t3code" },
    { isPackaged: true, packageName: "t3code", expectedName: undefined },
    { isPackaged: false, packageName: "t3code-fork", expectedName: undefined },
  ])(
    "shares the official runtime name for the packaged fork ($packageName, $isPackaged)",
    ({ isPackaged, packageName, expectedName }) => {
      const setName = vi.fn();
      const isFork = configureForkDesktopApp({ isPackaged, getName: () => packageName, setName });

      expect(isFork).toBe(expectedName !== undefined);
      expect(setName.mock.calls).toEqual(expectedName === undefined ? [] : [[expectedName]]);
    },
  );
});
