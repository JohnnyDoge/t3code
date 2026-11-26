// fork(board): Local Node uses the same dialog without a secret.
import type {
  EnvironmentId,
  SecretReference,
  UnifiedSettings,
  UsageLimitSourceConfig,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { useId, useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { sourceIdFromUrl } from "./AddUsageLimitSourceDialog.logic";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";
import { Label } from "../ui/label";

/** Send the management key once to server secret storage; settings retain only a redaction marker. */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
  sources,
  kind = "cliproxy",
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly kind?: UsageLimitSourceConfig["kind"];
  readonly sources: UnifiedSettings["usageLimitSources"];
}) {
  const gt = useGT();
  const formId = useId();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const secretSources = useSecretSources(environmentId);
  const [keyDraft, setKeyDraft] = useState<string | SecretReference>("");
  const [keyValid, setKeyValid] = useState(true);
  const managementKey = typeof keyDraft === "string" ? keyDraft.trim() : keyDraft;
  const trimmedUrl = url.trim();
  const localNode = kind === "local-node";
  const http = kind !== "cliproxy";
  const endpoint = URL.parse(trimmedUrl);
  const canSave =
    keyValid &&
    (http
      ? endpoint !== null &&
        /^https?:$/.test(endpoint.protocol) &&
        !endpoint.username &&
        !endpoint.password &&
        (!localNode ||
          (["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) &&
            !endpoint.search &&
            !endpoint.hash &&
            ["/", "/v1", "/v1/"].includes(endpoint.pathname)))
      : trimmedUrl.length > 0 && managementKey !== "");

  const reset = () => {
    setLabel("");
    setUrl("");
    setKeyDraft("");
    setKeyValid(true);
  };

  const save = () => {
    if (!canSave) return;
    const id = sourceIdFromUrl(trimmedUrl, sources, kind);
    updateSettings({
      usageLimitSources: {
        [id]: {
          kind,
          ...(label.trim() ? { label: label.trim() } : {}),
          url: trimmedUrl,
          managementKey: localNode ? "" : managementKey,
          enabled: true,
        },
      },
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {localNode ? (
              <T>Add Local Node</T>
            ) : http ? (
              <T>Add an HTTP quota source</T>
            ) : (
              <T>Add a CLIProxyAPI hub</T>
            )}
          </DialogTitle>
          <DialogDescription>
            {localNode ? (
              <T>
                Show slots and estimated token budgets from the Local Node dashboard on{" "}
                <Var>{environmentLabel}</Var>.
              </T>
            ) : http ? (
              <T>
                Read quotas from an endpoint on <Var>{environmentLabel}</Var>.
              </T>
            ) : (
              <T>
                Show the quota of every Codex, Claude, and Grok account the hub pools, next to the
                providers on <Var>{environmentLabel}</Var>. The key stays on that server.
              </T>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-url">
                {localNode ? <T>Dashboard URL</T> : http ? <T>Endpoint URL</T> : <T>Hub URL</T>}
              </Label>
              <Input
                id="usage-source-url"
                placeholder={
                  localNode ? "http://127.0.0.1:8787" : "https://hub.example.ts.net:8318"
                }
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
              />
            </div>
            {!localNode ? (
              <div className="grid gap-1.5">
                <Label htmlFor="usage-source-key">
                  {http ? <T>Bearer token (optional)</T> : <T>Management key</T>}
                </Label>
                <SecretSourceInput
                  id="usage-source-key"
                  aria-label={http ? gt("Bearer token (optional)") : gt("Management key")}
                  value={keyDraft}
                  sources={secretSources}
                  environmentId={environmentId}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  onSecretChange={(secret) => setKeyDraft(secret ?? "")}
                  onValidityChange={setKeyValid}
                />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-label">
                <T>Label (optional)</T>
              </Label>
              <Input
                id="usage-source-label"
                placeholder={localNode ? gt("Local Node") : gt("Defaults to the hub's host name")}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            <T>Cancel</T>
          </Button>
          <Button type="submit" form={formId} disabled={!canSave}>
            {http ? <T>Add source</T> : <T>Add hub</T>}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
