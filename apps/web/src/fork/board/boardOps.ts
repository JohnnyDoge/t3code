/** One step of a board action. See docs/fork/FORK.md section 2.5. */
export type BoardOp =
  | { readonly kind: "tag"; readonly tag: string; readonly tagged: boolean }
  | { readonly kind: "settle" }
  | { readonly kind: "unsettle" }
  | { readonly kind: "unsnooze" }
  | { readonly kind: "open-snooze-menu" };
