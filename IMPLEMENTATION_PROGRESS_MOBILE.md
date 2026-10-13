# Mobile MVP implementation ledger

Spec: IMPLEMENTATION_SPEC_MOBILE_SUPABASE_SOL.md
Start: 2026-10-12, baseline c88aaaf. Only existing difference: untracked specification from this conversation.

## Plan

1. Shared data contract and task mutation model. Tests: missing fields, device preference preservation, duplicate task text, weekday rule isolation, undo.
2. User/tab storage, durable queue and sync engine. Tests: CAS conflict, delayed responses, response loss, new edits during save, auth isolation, storage failure.
3. Supabase migration: private allowlist, RLS, atomic CAS and idempotence. Validate on independent local Postgres-compatible test database; never use production data as fixtures.
4. Desktop integration: all write paths, migration, account storage, conflict recovery, alarm removal.
5. iPhone view: month/week calendar, agenda, common notes, task status sheet, undo, login. Verify with Playwright MCP at 428x926 and 428x740.
6. Bundled SDK, dist allowlist, setup guide, regression tests and final fresh review.

## Rulings

- Work in the user-selected checkout, preserving the untracked specification. No shared-branch push or deployment requested. Git metadata is read-only under the current profile, so commits are not required for this implementation.
- Existing Supabase project is named TaskKari. This does not rename the application or repository. Public connection parameters requested asynchronously; prepare deployable SQL and configuration independently.
- Implement browser flows without a service worker in MVP: open-page offline cache is required; offline cold start is optional in the spec.

## Evidence

- GitHub MCP authenticated as KoiChem; repository context requested.
- Playwright MCP connected, initial about:blank tab available.
- Supabase official RPC/RLS docs reviewed 2026-10-12.
- Shared model, durable CAS engine, user/tab storage, desktop integration, mobile UI, pinned SDK build, public dist workflow and setup instructions implemented.
- Independent fresh review identified seven Important issues. Fixed local-apply atomicity, unauthenticated reload privacy, latest initial migration source, early account switch clearing, verified offline cache restoration, duplicate-tab identities (Web Locks), invalid data quarantine/blocking. Added focused regressions.
- 44 Node tests passed, including actual SQL in isolated PGlite/Postgres. No live user test data written.
- Playwright MCP (disposable contexts, synthetic API/session fixtures): 428x926 and 428x740, 42-day calendar/44px cells, week switch, duplicate-title status updates, undo inside native dialog, offline readonly cache, desktop initial migration/latest edits, remote apply without echo, logout/reload privacy. Page exceptions: none.
- Approval review rejected destructive browser fixture storage.clear; replaced with a newly created disposable context and no reset of existing browser storage.
- User approved SQL application at action time. Applied migration to TaskKari via signed-in Supabase SQL Editor; success confirmed, all 3 tables have RLS=true. No existing application tables were present.
- App Auth user created by the human and confirmed in Auth Users. After action-time approval, added that user to the allowlist; SQL returned the matching user ID. Human logged into the local Chrome preview. Mobile showed the authorized empty-cloud state; desktop shared the session and showed the initial-sync action. Actual user-data upload and live two-way sync are not yet performed. Preview summary: no date overrides, events or weekly rules; wait for the existing desktop backup before initialization.
- Publication/push not requested. Actual iPhone Safari and live-user two-way data synchronization still require separate evidence.

- Final live anonymous API smoke check: Project settings HTTP 200, public signup disabled, email enabled, anonymous sign-in disabled. Documents read and save RPC both HTTP 401 / SQL 42501 without an authenticated session. No application records created.
- Final Node suite: 44/44 passed. Browser fixture suites passed after final changes. Build and whitespace checks passed. Screenshot: thread visualization directory/taskkanri-mobile-mvp.png (synthetic data).

- 2026-10-13: Human supplied `/Users/ikemon/Downloads/261013_TaskKanri.json`. Core import validation succeeded: academic year 2026, 411 override days, 133 event days, 25 holiday days, 7 count settings. Source file untouched; live cloud upload still pending. Chrome CUA connection timed out twice; Playwright is connected in a separate unauthenticated context and cannot reuse the human Chrome session.
- Export names now use Tokyo date `YYMMDD_TaskKanri.json`; recovery exports use `YYMMDD_unsent_TaskKanri.json`, `YYMMDD_received_TaskKanri.json`, or `YYMMDD_quarantine_TaskKanri.json`. Build and whitespace checks passed after this change.

## Task interaction improvement (2026-10-13)

- User reported initial synchronization and mobile display working, then authorized implementation and publication of the agreed three UI improvements.
- PC badges are restored as noneditable after sanitized rendering/paste and before native paragraph breaks. Empty accidental badge wrappers are unwrapped without clearing ordinary text formatting. Own sync acknowledgments use semantic payload equality and retain editor DOM/history.
- Mobile status changes patch badges and button selection in place, with durable queued writes debounced at 800ms (maximum wait 5s). In-flight changes use the existing CAS queue; successful acknowledgments retain the sheet and scroll. Undo restores the immediately preceding local operation and is preserved across own save revisions.
- Sync menu reports progress, success, cancellation and actionable failures; busy actions prevent repeat submission. Refresh now returns an explicit outcome so network errors cannot be shown as success.
- Prepublication evidence: 44 Node checks passed; disposable Playwright fixtures verified rapid changes combined into one save, retained sheet/button DOM and scroll through acknowledgment, undo, offline read-only cache and failure feedback. PC fixtures verified Enter/Shift+Enter and native undo, retained ordinary color/background, stable editor after own save, refresh/logout success messages. No live user data was modified by these fixtures; physical iPhone Safari is not verified.
