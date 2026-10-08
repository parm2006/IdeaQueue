# IdeaQueue rebuild

## Product and visual direction

One responsive web app instead of separate desktop and mobile codebases. The desk is off-white paper, navigation is forest green, and ideas are pastel sticky notes. The box always shows one full upcoming note, chosen by priority. Popping reviews that note and displays the next one. One Add idea button opens the shared typing and voice dialog. Desktop has a persistent sidebar; mobile uses compact navigation. All illustrations are CSS/SVG, with no external image dependencies.

## Core behavior

- Capture text, optional context, class/category, note color, and priority (1–10).
- Use a binary heap: adjusted UTC creation day ascending, stored starting priority descending, real capture timestamp ascending, then ID.
- The adjusted day is UTC creation day minus starting priority days. Current points are today's UTC day minus that adjusted day; they grow daily without a cap or daily writes. Keep actual timestamps and starting priorities unchanged.
- Always display the highest-priority pending idea from all buckets or the selected bucket, alongside the queue count. Pop reviews the visible idea and displays the next one. Loading or viewing never marks it reviewed. A stale pop must refresh without reviewing another note. Keep past pops in Reviewed, where notes can be edited or restored without losing their original creation time. Remove pending-note browsing, search, sort controls, and redundant capture buttons/forms.
- Provide a clearly labeled browser-local workspace with example notes. Saved personal notes survive refresh. Examples stay separate from the cloud account.
- The hosted Site uses owner-only Sites sign-in and a managed D1 database. A Worker API validates writes and uses one atomic SQLite pop statement. The existing Supabase path remains optional for independent deployments.
- Refresh cloud data when the app regains focus and when the user requests a refresh. Cloud failures show an error and do not silently write to a different database.
- Export JSON and import validated JSON to move browser-local notes into a cloud account or back up data.
- Offer microphone capture inside the one Add idea dialog, continuous dictation with interim feedback and deduplicated final segments, permission errors, and cleanup on dismissal. Infer an unchosen bucket from note text only. Context is optional and exclusively user-written; date and hour remain capture metadata.

## Execution

1. Save the original README, archive the old source, and remove the old frontend/backend runtime. Preserve both SQLite files.
2. Host owns UI, persistence, authentication, and database authorization. A bounded subagent implements the pure queue module and unit tests.
3. Build the responsive React/TypeScript UI and app manifest. Bundle the hosted UI into a Worker ESM artifact with D1 migrations; retain browser-local development mode.
4. Verify priority semantics, persistence/import safety, production build, and desktop/mobile interactions.
5. Publish the owner-private Site with D1 storage. Provide Home Screen installation and private iOS Shortcuts capture instructions. Optional speech capture uses browser speech recognition where available.

## Phone and private API update

Reduce mobile navigation to Box/Reviewed tabs and a bucket selector. Hide the decorative desktop hero and footer, use 44px touch targets and 16px form inputs, honor iPhone safe areas, and keep optional capture fields collapsed. Provide a PNG touch icon and standalone manifest. Test both browser contexts against SQLite for shared persistence, ranking, restore, and simultaneous pops. Only capture accepts a platform-authorized service caller; all other APIs require browser visitor identity. The private Sites dispatch authenticates service requests with the owner's service credential. Do not expose this credential in source or the UI. Existing browser notes move online only on explicit import.

## Scope boundaries

No paid AI service, native app wrappers, background transcription, or billing. Browser-local mode is not cross-device sync. Existing SQLite data is retained and can be exported with the supplied read-only migration script; it is never silently uploaded.
