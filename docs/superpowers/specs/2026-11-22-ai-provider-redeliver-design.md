# Redeliver a pending AI provider file

> Design. Status: the owner approved building it on 2026-11-22; the decisions of section 5 follow the recommended
> defaults; not built. Paths are under `apps/control-plane/src/ai-provider/` unless noted. The study read code only.

## 1. What exists today

- **The file.** A save (`PATCH /v1/platform/ai-provider`, `http.ts`) writes the rows, the audit entry and the file
  the AI service reads in one transaction under the session lock `AI_PROVIDER_SAVE_LOCK`. The file is written only
  for a configuration that routes a default model.
- **Delivery state.** `deliveryOf` (`store.ts`) computes it on every read: `unconfigured` (no path), `incomplete`
  (no default route), `delivered` (the file parses and holds the stored revision), otherwise `pending`. Nothing is
  stored. `pending` therefore means the file is missing, unreadable, in an older shape, or at another revision.
- **Repair.** Only two paths rewrite the file: `syncProviderFile` (`sync.ts`), called once at start-up, and a new
  save. The console allows a save only with a changed draft (`apps/vendor-admin/app/pages/ai-provider.vue`). A vendor
  who sees `pending` must restart the control plane or make a needless change.
- **The page.** It shows the delivery state as an alert with no action. It does not say that a model must be saved,
  then tested, before it can become the default.
- **Why the order exists.** `validated` (`http.ts`) refuses a new or changed route to a model that is unpriced
  (`model_not_priced`) or whose last test did not see token counts (`model_not_tested`). The test route works on
  saved providers only. So: save the provider and model, test, then route and save.

## 2. Behaviour

**Route.** `POST /v1/platform/ai-provider/redeliver`, body `{reason}`. It answers 200 with the same view as `GET`,
plus `outcome`. The stored configuration is rendered with `providerFileContent` and compared with the file, as
`syncProviderFile` does.

| State before | Result |
| --- | --- |
| File differs or is missing | written; `outcome: "written"`; the view now says `delivered` |
| File already matches | nothing written; `outcome: "unchanged"`; 200 |
| No default route, or nothing saved yet | 409 `provider_incomplete`; nothing written |
| No path configured | 409 `provider_file_unconfigured` |
| Key cannot be opened | 503 `secret_key_unavailable` |
| Write fails | 503 `provider_file_unavailable`; the previous file is put back |

The revision is not changed, no row is written except the audit entry, and no test result is reset.

**Page.** In state `pending` the delivery alert gains one sentence ("The AI service is still using the previous
file") and a button "Deliver again" that opens the existing confirm block with a reason field. The button is
disabled while the draft is dirty, with the hint to save or discard first. In `incomplete` the alert names the
missing default model and has no button. After the call the page reloads the setting.

**Explanatory text.** A short numbered note above the models section, always visible: (1) add the provider and the
model with its prices, then save; (2) test the model, and the test must report token counts; (3) choose it as the
default, or for a quality level, and save again. The blocker messages for `model_not_tested` and
`model_not_priced` link to this note.

## 3. Safety rules

- Capability `vendor.ai.manage` with a fresh step-up, as every write of this resource (confirm in code that a POST
  to the new route gets the step-up check). Reason of 3 to 1000 characters.
- Audit event `ai.platform_provider.redelivered`: actor, reason, revision, `outcome`, and the delivery state before. A key that cannot be decrypted is `secret_key_unavailable`; any other failure is audited with `outcome: failed` and answered as it is. If the file was replaced but the entry cannot be written, the answer is 503 `audit_unavailable` (the next call answers `unchanged` and records the entry).
  It is written for `unchanged` and for a failure too. Never a key.
- The write reuses `replaceProviderFile` unchanged: temporary file in the same directory, mode 640, `fsync`,
  rename, directory `fsync`, removal of stale temporary files, absolute path required, restore on failure.
- It runs under `AI_PROVIDER_SAVE_LOCK`, the lock a save and the start-up sync take.
- No network call is made. The SSRF protections (`endpoint.ts`, `guarded-fetch.ts`) are untouched.
- The "priced and tested" rule is not applied, as in `syncProviderFile`: the action delivers what a save already
  accepted and cannot change what is routed.
- Idempotent: a repeat finds the file equal and answers `unchanged`.

## 4. Implementation note

`syncProviderFile` logs a failure and returns `'failed'`, and it drops the restore function. Move its body into one
function that throws, used by both the start-up sync (which keeps catching and logging) and the route (which maps
errors to the codes above). The rendering and the write stay single.

## 5. Decisions (recommended defaults, taken)

| # | Question | Decision |
| --- | --- | --- |
| D1 | When the file already matches | 200 `unchanged`. |
| D2 | When the button shows | Only in `pending`. |
| D3 | Automatic repair | Manual only; no periodic re-sync. |
| D4 | Reason field | Required, as for a save. |

## 6. Out of scope

A periodic or automatic re-sync, telling the AI service to reload, showing the file content or a diff, redelivery
of an incomplete configuration, a change to the save rules or to the test, history of deliveries, any change to
`endpoint.ts`, `guarded-fetch.ts` or `client.ts`.

## 7. Tasks (one commit each)

1. Contract: request schema `{reason}`, `outcome` on the answer, the two new 409 codes.
2. Shared core in `sync.ts` and the route in `http.ts`. Tests: written from a missing file, from an older revision
   and from unparsable content; `unchanged`; each refusal; the file restored on a failed write; the revision and
   the test results untouched; the audit row for each outcome; 403 without the grant; `step_up_required`; 422 for a
   short reason; a redeliver waits for a save holding the lock; start-up sync unchanged.
3. BFF: add `redeliver` to the allowlist in `apps/vendor-admin/server/utils/proxy.ts`, bound to POST. Tests:
   allowed with POST, refused with GET.
4. Console: the button, the confirm block, the dirty-draft guard and the `incomplete` wording on `ai-provider.vue`;
   Arabic and English texts. Tests: shown only in `pending`, disabled when dirty, the reload after success, the
   error codes rendered.
5. Console: the three-step note and the links from the two blockers. Tests: the note renders; the links resolve.
6. Docs: the AI provider part of `docs/operations/saas-commercial-runbook.md` (what `pending` means and the action).
