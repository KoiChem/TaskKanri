# Offline settings and selective data transfer

Approved scope: offline status stays fixed and sync/auth requests stop; both clients export/import from sync settings; export offers native file sharing when supported; only changed import items appear, initially selected. Schedule selection is one slot, event one date, global tasks one block, settings one group. Missing incoming entries preserve local data; explicit blanks are deletions.

1. Add pure import planning/apply functions and tests for source-field presence, explicit blanks, unselected and missing entries, stale previews, legacy conversion, and academic year changes.
2. Add a shared transfer UI: export choice menu, capability-detected JSON sharing, file picker, grouped difference list, selectable rows and fixed confirmation footer. Reuse PC recovery snapshots; back up mobile state and pending changes before importing. Route existing PC import buttons through the same preview.
3. Abort sync/auth fetches and stop timers on manual offline entry; ignore stale callbacks and hold the PC label at オフラインモード.
4. Run the full tests, build and diff checks, then use Playwright for PC and iPhone 13 Pro Max browser flows including true offline edits, changed-only previews, selection, deletion, persistence, network suppression and share fallbacks.
5. Commit and push the authorized release; confirm Pages deployment and repeat the relevant public browser flow. Physical-device Gmail attachment delivery requires device testing and is not claimed from browser emulation.

## Verification and review

- Added source-aware merge tests including explicit deletions, absent/unselected fields, partial settings, stale previews, academic year requirements, and legacy schedules/day profiles.
- Review found and fixed save cancellation being blocked, and first-save cancellation without an existing mobile cache. Pending mutation IDs, attempted flags, expected revisions, and following edits remain durable.
- Local Playwright: PC and 428x926 mobile; changed-only selection, explicit deletion and reload/export persistence, year confirmation, legacy PC import button, JSON share payload and unsupported-share fallback, quota-failure safety, full-width mobile preview and footer.
- Mocked Supabase save deliberately held pending: switching offline retained imported tasks/events and reload made zero additional Supabase requests. Authentication request held pending: no additional auth requests over 17 seconds after offline entry.
- Native Gmail delivery and physical iPhone interaction were not performed.
