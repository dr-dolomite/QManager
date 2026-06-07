# Error Code Vocabulary (Plan 12+)

- **Namespace**: `errors` in `public/locales/{en,zh-CN}/errors.json`. Flat dictionary, 148 keys: 146 stable backend error-code strings + two catch-alls (`unknown`, `unknown_with_detail`).
- **Backend contract**: CGI scripts + daemons emit `{ error: "<code>", detail?: "<string>" }` (or `{ success: false, error, detail }`). Codes are stable snake_case tokens. Do NOT rename existing codes without a coordinated frontend sync — they are contract.
- **Frontend resolution**: use `lib/i18n/resolve-error.ts::resolveErrorMessage(t, code, detail, fallback)`. Tries `errors.<code>`; unknown code with detail → "Modem reported: {{detail}}"; no code → detail verbatim; else caller fallback.
- **Usage pattern** (any component with `t` in scope from any namespace):
  ```ts
  toast.error(resolveErrorMessage(t, res.error, res.detail, "Save failed"));
  ```
  The helper resolves via `{ ns: "errors" }` explicitly, so the caller's own namespace hook is fine — no second `useTranslation` needed.
- **Adding a new code**: emit the snake_case string from the CGI → add one key to EN `errors.json` → add the zh-CN counterpart. `bun run i18n:check` enforces parity.
- **AT-commands namespace migration**: Plan 12 moved `system-settings.at_terminal.{commands,blocked_*,warning_disable_radio}` out into a new `at-commands` namespace (26 command labels + `blocked.*` + `warnings.*`). `BLOCKED_COMMANDS` / `WARNING_COMMANDS` `messageKey` values dropped the `blocked_`/`warning_` prefix; consumers resolve via `t(\`blocked.\${key}\`, { ns: "at-commands" })` / `t(\`warnings.\${key}\`, { ns: "at-commands" })`.

