# IdeaQueue

A responsive idea box for phone and desktop, with a spiral notebook for browsing your thoughts. One **Add idea** button captures typed or dictated thoughts. The notebook opens on the highest-priority note; **Pop idea** reviews the displayed note and returns to the highest remaining priority. **Find out ↗** searches Google for that note's text.

Paired wire loops sit above the note controls, with a small fan of pages beneath showing the next ideas' actual colors. Browse with swipes, scrolling, or keyboard arrows; **Back to top** remains available. The Queue screen keeps functional labels and actions, with one **How IdeaQueue works** button for instructions.

[Open IdeaQueue](https://ideaqueue.vercel.app) · [GitHub repository](https://github.com/parm2006/IdeaQueue) · [Install the iPhone Shortcut](https://www.icloud.com/shortcuts/ace61478ef2547c68fb6341b2e522e24)

The Vercel app uses **Supabase Postgres + Supabase Auth with Google OAuth**. Everyone signs into their own account; row-level security isolates their notes. Firebase is not used. Signed-out visitors get a sign-in screen. There is no anonymous note workspace or browser-only fallback.

## Use the app

1. Open the live app and continue with Google. Each account starts with its own private idea box.
2. Choose **Add idea** to type or dictate a thought. Bucket, starting priority, context, and color are optional.
3. Start with the highest-priority thought, then swipe up/down or scroll over the notebook to browse other ideas in priority order. **Pop idea** moves the displayed thought to Reviewed and returns to the highest remaining priority; **Find out** opens a Google search for that thought.
4. Use Reviewed to revisit or restore a note. Settings includes your reviewed-note cleanup preference, backups, the iPhone Shortcut installer, and personal capture tokens. Add idea stays available on both tabs.

The live app is configured for Google sign-in and Supabase storage. The setup instructions below are for developers deploying another instance.

The notebook supports up/down arrow keys and Page Up/Page Down, with no on-screen previous/next buttons. Navigation loops from the last idea to the first and from the first to the last. Arrow keys work anywhere on the Queue screen except while editing or using a dialog. **Back to top** or Home returns to the highest priority; reopening Queue or changing buckets starts there too. Browsing makes no database writes. Long notes scroll within their page before another gesture turns the page. Page-turn animations respect reduced-motion preferences.

## Stack

React 19, TypeScript, and Vite provide the frontend. Supabase Postgres stores notes; Supabase Auth handles Google OAuth and PKCE sessions. Database row-level security separates accounts. A Vercel Node function provides the create-only Shortcuts API. Vitest covers queue ordering, dictation, import validation, and API authorization. The queue uses a binary heap in the browser and matching indexed ordering in Postgres.

## Set up another deployment

Follow [the exact Supabase and Google setup steps](docs/vercel-setup.md). Run `supabase/setup.sql`, `supabase/maintenance.sql`, `supabase/reviewed-retention.sql`, and `supabase/maintenance-schedule.sql` in that order, then enable the Google provider and configure the Vercel return URL. The retention migration is required by the current frontend. No old test notes are migrated. Client code needs only the public Supabase URL and publishable key.

## Run locally

Requires Node.js 20.18+.

```sh
npm ci
# Copy .env.example to .env.local and enter your public Supabase key.
npm run dev
npm test
npm run build
```

`npm run build` outputs the Vite website into `dist`. Vercel builds the site and runs `api/ideas.ts` and `api/sync.ts` as Node functions. Vercel's GitHub integration deploys changes to the repository's main branch. `.env.local`, database files, old-source archives, and temporary QA files are excluded from Git and Vercel uploads.

## Queue ordering

- Store starting priority once (1–10).
- `queue day = UTC capture day − starting priority`.
- Sort oldest adjusted day first, then higher starting priority, earlier capture timestamp, and UUID.
- Displayed points equal today's UTC day minus queue day. They grow by one daily without database writes.
- The browser heap and atomic Supabase pop use the same ordering. Viewing a note never reviews it. Stale pops refresh the queue instead of reviewing another note. Restoring a note preserves its original capture date.
- Bucket suggestions use note text only. Context is always user-written; dictation adds only the transcript.

## Mobile and Shortcuts

On iPhone, open the Vercel URL in Safari → Share → Add to Home Screen. Mobile navigation uses Queue/Reviewed and a bucket selector; optional capture fields are collapsed. Pop idea and Find out occupy equal halves of the action row. External search behavior is controlled by the browser and OS. Dictation requires browser/device support and microphone permission; keyboard dictation is a fallback.

The desktop sidebar and Settings include the [shared iPhone Shortcut](https://www.icloud.com/shortcuts/ace61478ef2547c68fb6341b2e522e24). Settings lets each authenticated user create/revoke a personal, create-only token. **Copy authorization** includes the required Bearer prefix; paste it into the template's blank Authorization header. The template saves each thought to `On My iPhone/IdeaQ/outbox.txt`, sends the complete queue to `/api/sync` when run on Wi-Fi, and clears its contents only after a positive saved count. Failed requests preserve the queue. Owner and capture time are set by the database at sync time. The raw token is shown once; only its hash is stored. See [capture implementation details](docs/SHORTCUTS.md#offline-outbox).

On supported iPhones, select the installed **Idea Queue Template** under **Settings → Action Button → Shortcut** (or rename it Idea Queue). Allow local file access and select your own **On My iPhone** destination if the imported folder reference needs resetting. The shared template intentionally contains no user's authorization.

The Shortcut retries its queue when run on Wi-Fi; reconnecting alone does not launch a background sync. Each sync accepts at most 50 ideas and a 64 KiB request body. The web app itself still requires a connection. Retries after partial writes or a lost server response can create duplicates; batches are not atomic or deduplicated. Queued ideas receive their database timestamp when synced, so priority aging starts then.

The capture JSON accepts only `text` (required), `context`, `category`, `priority`, and `color`. Extra fields return HTTP 400; do not send `user_id`, an ID, capture dates, reviewed status, or empty placeholder fields from the Shortcut editor. The database supplies ownership and capture time. Successful capture returns HTTP 201 with the new note's ID and timestamp.

## Database maintenance

Open **Settings → Reviewed cleanup → Delete reviewed ideas every hour** to choose your account's retention:

| Setting | When reviewed ideas are permanently deleted |
|---|---|
| On (default) | At the next hourly cleanup |
| Off | Once each idea has spent 7 days in Reviewed, at the next hourly cleanup |

Supabase Cron still runs at the top of every hour in both modes. The 7-day age uses `reviewed_at`, not the idea's original creation date. Pending notes are preserved, preferences sync across devices, and **Add idea** stays on both tabs; there is no manual clear button. The live project has this enabled. Existing deployments with maintenance installed need only `supabase/reviewed-retention.sql` to add the preference feature; fresh deployments use the full installation order above.

A private database trigger checks allocated database size before inserting notes or growing their text/context. It blocks writes at a conservative 450,000,000-byte threshold, reserving headroom below Supabase's free-tier quota. It covers browser saves/imports and both Shortcut endpoints. API storage failures return HTTP 507 without a positive saved count, so the Shortcut retains its queue. This measures database allocation, not exact provider disk, WAL, object-storage, or organization billing headroom. PostgreSQL autovacuum reuses space after deletion; allocated database size may not immediately shrink.

## Validation

Run `npm test` and `npm run build` for automated checks and the production build. `supabase/shortcuts.test.sql` exercises two-account isolation, token ownership, revocation, and capture defaults in an isolated PostgreSQL database; its fixtures roll back. It is a psql test script, not part of production setup. Phone and desktop browser checks verified the sign-in gate, upcoming-note behavior, installer link, complete authorization clipboard value, and absence of token persistence in browser storage. Physical iPhone dictation and Action Button behavior depend on device setup.

Chromium checks at phone and desktop sizes cover notebook touch swipes, wheel and keyboard navigation, priority resets, browsing without writes, popping the displayed note, long-note scrolling, narrow layouts, and reduced motion. Physical iPhone Safari gestures still need device verification.

`supabase/maintenance.test.sql` verifies capacity rejection and preservation of pending notes. `supabase/reviewed-retention.test.sql` verifies account isolation, both retention modes, the exact 7-day review-age boundary, and re-enabling hourly deletion. Both are transactional scratch-database tests, not production setup scripts. Phone and desktop checks with synthetic accounts also verified that the Settings preference persists after reload and Add idea remains on both tabs.

## Source layout

- `src/App.tsx`: responsive box, capture sheet, upcoming note, and reviewed tray.
- `src/components/IdeaNotebook.tsx`: priority-ordered notebook navigation and page-turn animation.
- `src/lib/useIdeas.ts`: authenticated note reads/writes and account transitions.
- `src/lib/supabase.ts`: Google sign-in and PKCE session handling.
- `supabase/schema.sql`: notes, row-level security, indexes, atomic pop.
- `supabase/setup.sql`: combined database installation script for a new deployment.
- `supabase/shortcuts.sql`: private token hashes and narrowly scoped capture functions.
- `supabase/shortcuts.test.sql`: transactional account/token privacy checks.
- `api/ideas.ts`: Vercel create-only capture endpoint.
- `api/sync.ts`: Vercel endpoint for a local Shortcut outbox.
- `supabase/maintenance.sql`: database storage guard.
- `supabase/reviewed-retention.sql`: private per-account preferences and admin-only retention cleanup.
- `supabase/maintenance-schedule.sql`: hourly reviewed cleanup and app cron-log retention.

The previous ChatGPT Sites app uses Cloudflare D1 and its private Sites access boundary. Its worker, migration history, and `npm run build:sites` command remain for reference; they are not the Vercel database/API. Old source and SQLite files stay preserved locally and are not published. Original requirements are in `docs/original-spec.md`.
