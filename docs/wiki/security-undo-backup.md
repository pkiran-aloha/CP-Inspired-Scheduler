# Security, Undo and backup

_Sources: src/lib/security.js, src/lib/workspaceBackup.js, src/components/SecurityView.jsx, src/components/settings/SystemPanel.jsx, src/components/SettingsModal.jsx, src/state/store.jsx, src/App.jsx_
_Last synced with main at c5211e0 on 2026-10-05 (plus demo family balances)._

Three safety nets protect a workspace that lives only in one browser: role-based access (a local demo, not authentication), a 25-step Undo, and a versioned JSON backup with a storage-failure alert.

## User guide

### Security (accounts and roles)

Open Settings, Security (also reachable from the nav for accounts with access). The page has a banner that reads "Local demo access controls, not authentication". Permissions are enforced inside this browser's UI and state actions. There are no passwords, no sign-in and no server-side identity check, and anyone with the browser can switch account.

**Roles.** A role sets an access level for each of 14 areas: Schedule, Clients, Intake, Staff, Masters, Billing, Verification forms, Payroll, QuickBooks Payroll, Analytics, Reports, Dashboard, Workspace settings and Security administration. Each level is Full access, View only or No access. Seven roles come built in: Administrator (protected), Clinical Supervisor, Scheduler, Clinician, Billing Specialist, Payroll Manager and Read Only. You can create more.

**Accounts.** An account links a staff member to a role and one or more offices. All-office access is reserved for an Administrator. Users with office scope see only records in their offices (appointments, claims, clients, staff, teams, pay runs and so on are filtered before any screen, search or report reads them).

**Preview.** The Preview button on an account switches the local demo to that account so you can see what its role can do. The header shows "Previewing: <name> · <role>". A denied route redirects to the first screen the account may open.

**What is refused and why.** When an action needs access the current account lacks, a toast says "Your current role does not have full access to <area>." (or "view access"). Out-of-scope records say "The selected record is outside your assigned office scope." Read-only screens show a "View only" pill. In the shared severity language these are stop-level refusals; nothing changes.

**Security rules that protect you from lockout.**
- At least one active user must keep full Security access.
- The built-in Administrator role and the demo administrator account are protected.
- You cannot change your own assignment or remove your own account; another administrator must.
- A role cannot be deleted while an account uses it.
- A staff member needs a valid email before getting an account, and one account per staff member.
- Removing a staff member suspends the linked account.
- Every change writes an audit entry (last 200 kept).

**Policy fields that are stored but not enforced.** Settings, System also holds MFA required, screen lock minutes and auto-logout minutes. They are saved with the workspace but nothing in the app reads them; there is no sign-in or lock screen.

### Undo

- **Press U** (it is ignored while you type in a field or while a dialog is open) or use the Undo button on a toast. The most recent change is reversed and a toast says "Undone".
- **One action, one Undo.** A compound change, such as assembling claims with their invoices, posting an ERA, or restoring a backup, is a single step.
- **Depth.** The last 25 steps, in this browser tab only. Reloading the page or opening another tab starts with an empty Undo.
- **What Undo covers.** Only the data the change touched is restored. Unrelated edits made afterwards (a theme switch, say) stay. Undo also checks your access: it is refused if reversing the step would touch a record outside your office scope or an area you cannot edit.
- **What has no Undo.** Changes that take no snapshot: plain settings patches, security accounts and roles, payer add or edit or remove (only the Payment Terms save snapshots), staff and client roster edits, service and custom-field masters, dashboard and saved-report edits, and view changes. Check the toast: an Undo button appears only where one exists.

### Backup and restore

Settings, System, "Data & backup" shows storage use and three actions.

- **Export workspace (.json)** downloads `aloha-aba-backup-<date>.json`. It holds every durable collection: appointments, claims, payments, invoices, ERA imports, billed files, QuickBooks records, verification forms, staff, clients, teams, payers, services, custom fields, settings, security, saved reports, dashboards, payroll data, intake requests, referral sources, client statements, the Cabinet document register, the training / CEU log, inbox tasks and messages. It does not hold navigation state or Undo history. The file is not encrypted; treat it with care even though the seed data is fictional.
- **Restore backup...** reads a file (50 MB limit), validates it, and shows a preview of counts. Nothing changes until you press "Replace workspace". Cancel leaves the workspace alone. A successful restore is one Undo step, with an Undo button on the toast.
- **Older files.** A version 2 file is accepted and gets the current demo security defaults. The oldest seven-field export (appointments, claims, staff, clients, teams, settings, reports) is accepted with a warning: it never contained masters or billing ledgers, so those start empty.
- **Who can back up.** Export and restore need Full access to every area and all-office scope. Others see a message saying so.
- **Rejected files.** Wrong format, an unsupported version, a ledger entry whose key differs from its id, an invalid claim, payroll profile, intake request or patient-receipt ledger that does not reconcile, and similar problems all stop the restore with a plain message and leave your data untouched.

**Demo data.** The same screen has "Regenerate demo data" (rebuilds the sample schedule and billing, plus sample Cabinet documents, CEU and PDU entries, tasks and messages from `src/lib/demoRecords.js`; keeps rosters and masters) and "Clear demo" (clears schedule and ledgers, keeps masters). Both ask you to click twice and are one Undo step.

### Storage-full alert

Changes are saved to localStorage about a quarter of a second after the last edit. If the browser refuses a write, a red alert across the screen says "Changes aren't saved in this browser (storage full or unavailable). Export a backup before closing this tab." with an Open Settings button that jumps to the backup screen. Until the next successful save, the edit exists only in this tab's memory.

## How it works

### Access control

[`security.js`](../../src/lib/security.js):
- Definitions: `SECURITY_AREAS`, `ACCESS_LEVELS`, `ROLE_TEMPLATES`, `defaultSecurity`, `normalizeSecurity`, `validateSecurityConfig`.
- Checks: `currentAccount`, `currentRole`, `accessLevel`, `canAccess`, `canAccessRecord`, `officesForRecord` (a claim's office scope comes from its client and from every session its lines bill, including each session on a merged same-day line), `scopeWorkspaceToAccount`, `areaForSection`, `canAccessSection`, `firstAccessibleSection`.
- Gate: `authorizeAction(state, action)`. It looks up the areas the action touches through the internal `actionAreas`, requires Full for everything except `setUI` and `toggleSel` (View), and then runs a per-action office-scope check. A `setUI` to the Help section touches no area at all: Help holds no practice data, so every role can open it.
- Rule for contributors: a new action type needs an entry in `actionAreas` **and** in the record-scope switch, otherwise it is refused as "This action is not authorized."
- Account and role changes: `applySecurityChange` validates the change and appends an audit entry. `createActions` exposes `securityMutation` and `switchDemoAccount`. The action authorizes and applies the change once to get the message, then dispatches `securityTx`, and the reducer applies it again against live state. `account.switch` needs no area.

[`store.jsx`](../../src/state/store.jsx): `StoreProvider` wraps dispatch in `guardedDispatch`, which calls `authorizeAction`, shows the refusal toast and returns `{ok:false}` without dispatching. `scopeWorkspaceToAccount` produces the office-filtered `visibleState` that screens read, while actions are built from it and plan against the raw state.

### Undo

- `pushSnap(state, fields, billingPatch, payrollPatch)` appends `{ __workspaceSnapshot: true, <touched fields> }` to `state.history`, keeping the last 25 (`slice(-24)` plus the new one). Billing and payroll settings are snapshotted as only the keys the action changed.
- Cases that push a snapshot: `upsertMany`, `patch` (unless `noSnap`), `deleteMany`, `claimsTx`, `payrollTx`, `intakeTx`, `record`, `settingsTx`, `importTx`, `clearDemo`, `reseed`, `relabel`, `replace`, and `payer` with mode `terms`.
- The `undo` case restores only the fields in the snapshot, drawing keys from `WORKSPACE_FIELDS`. Authorization for it is `areasForUndo` plus a record-by-record diff against office scope.
- History is never persisted: `serializeForStorage` writes `history: []`, `initial` drops any persisted stack, and the backup excludes it.
- The `U` key handler is in [`App.jsx`](../../src/App.jsx).

### Persistence

- `StoreProvider` runs an effect that debounces 250 ms, then `localStorage.setItem('aloha-aba.v3', serializeForStorage(state))`. A thrown write sets `saveError` and renders the `storage-warning` alert; a later successful write clears it.
- `initial()` reads `aloha-aba.v3`, falling back to the legacy key `pulse-aba-scheduler.v2`, merges every sub-object over current defaults, runs `normalizeWorkspace`, and writes back immediately only when a migration changed something or an old save carried history. `normalizeWorkspace` chains the migrations (the latest is the one-time `normalizeUnitNorms`, flag `meta.unitNorm15`) and then `normalizeSecurity`; it must be idempotent and return the same object when nothing changed so storage is not rewritten for no reason.
- A new durable collection must be added to `WORKSPACE_FIELDS`, validated on import and covered by a round-trip test and an Undo test (see [architecture](architecture.md)).

### Backup

[`workspaceBackup.js`](../../src/lib/workspaceBackup.js):
- `WORKSPACE_FIELDS`, `BACKUP_FORMAT` (`aloha-aba-workspace`), `BACKUP_VERSION` (3).
- `workspaceData`, `createWorkspaceBackup`, `validateWorkspaceData`, `readWorkspaceBackup(text, defaults)`.
- `readWorkspaceBackup` accepts version 3, version 2 and the format-less seven-field export, returns `{data, legacy, counts}`, and the reducer's `replace` case revalidates, rebuilds settings over defaults, normalizes, keeps the live `ui`, and snapshots for Undo.
- `validate` checks ledger maps (key equals id), roster lists, saved reports and dashboards, security config, appointments, claims, payroll profiles, sheets, runs and exports, intake requests and referral sources, payments, and that every patient receipt and reversal reconciles to the claims' `patientPaid`.
- UI: [`SystemPanel.jsx`](../../src/components/settings/SystemPanel.jsx) (`doExport`, `doImport`, `confirmRestore`); the `canManageWorkspace` flag comes from [`SettingsModal.jsx`](../../src/components/SettingsModal.jsx) and requires all-office scope plus Full on every area.

### Tests

[`security.test.js`](../../src/__tests__/security.test.js), [`securityUi.test.jsx`](../../src/__tests__/securityUi.test.jsx), [`workspaceBackup.test.js`](../../src/__tests__/workspaceBackup.test.js) (round trip, legacy import, rejection, atomic Undo of billing and reseed), [`store.test.js`](../../src/__tests__/store.test.js), and [`palette.test.jsx`](../../src/__tests__/palette.test.jsx) (storage-warning alert).

## Not yet built

- No authentication, passwords, MFA, lock screen, session timeout or server-side authorization. The Security page says so and means it. MFA, screen-lock and auto-logout settings are stored values only.
- Office scoping is a view filter in this browser; the full data is still in localStorage and in any backup an administrator exports.
- The audit trail covers security changes only (200 entries) and is not tamper-evident. There is no audit of financial or clinical edits beyond each claim's own history.
- Undo does not cover every change (see the list above), is limited to 25 steps and is lost on reload.
- Backups are manual downloads: no schedule, no encryption, no cloud copy, and no merge-restore (restore replaces the workspace).
- The only recovery from a full browser store is an export made before it filled; the alert tells you when saving has already failed.
