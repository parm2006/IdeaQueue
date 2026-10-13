# IdeaQueue

A responsive sticky-note idea box for phone and desktop. One **Add idea** button captures typed or dictated thoughts. The highest-priority note stays visible; **Pop idea** reviews it and shows the next note. **Find out ↗** searches Google for that note's text.

[Open IdeaQueue](https://ideaqueue.vercel.app) · [GitHub repository](https://github.com/parm2006/IdeaQueue) · [Install the iPhone Shortcut](https://www.icloud.com/shortcuts/5a8a5621902f4eeca0a761355b0d7e83)

The Vercel app uses **Supabase Postgres + Supabase Auth with Google OAuth**. Everyone signs into their own account; row-level security isolates their notes. Firebase is not used. Signed-out visitors get a sign-in screen. There is no anonymous note workspace or browser-only fallback.

## Use the app

1. Open the live app and continue with Google. Each account starts with its own private idea box.
2. Choose **Add idea** to type or dictate a thought. Bucket, starting priority, context, and color are optional.
3. The highest-priority upcoming thought stays visible. **Pop idea** moves it to Reviewed and shows the next; **Find out** opens a Google search for that thought.
4. Use Reviewed to revisit or restore a note. Settings includes backups, the iPhone Shortcut installer, and personal capture tokens.

The live app is configured for Google sign-in and Supabase storage. The setup instructions below are for developers deploying another instance.

## Stack

React 19, TypeScript, and Vite provide the frontend. Supabase Postgres stores notes; Supabase Auth handles Google OAuth and PKCE sessions. Database row-level security separates accounts. A Vercel Node function provides the create-only Shortcuts API. Vitest covers queue ordering, dictation, import validation, and API authorization. The queue uses a binary heap in the browser and matching indexed ordering in Postgres.

## Set up another deployment

Follow [the exact Supabase and Google setup steps](docs/vercel-setup.md). Run `supabase/setup.sql`, enable the Google provider, and configure the Vercel return URL. No old test notes are migrated. Client code needs only the public Supabase URL and publishable key.

## Run locally

Requires Node.js 20.18+.

```sh
npm ci
# Copy .env.example to .env.local and enter your public Supabase key.
npm run dev
npm test
npm run build
```

`npm run build` outputs the Vite website into `dist`. Vercel builds the site and runs `api/ideas.ts` as a Node function. Vercel's GitHub integration deploys changes to the repository's main branch. `.env.local`, database files, old-source archives, and temporary QA files are excluded from Git and Vercel uploads.

## Queue ordering

- Store starting priority once (1–10).
- `queue day = UTC capture day − starting priority`.
- Sort oldest adjusted day first, then higher starting priority, earlier capture timestamp, and UUID.
- Displayed points equal today's UTC day minus queue day. They grow by one daily without database writes.
- The browser heap and atomic Supabase pop use the same ordering. Viewing a note never reviews it. Stale pops refresh the queue instead of reviewing another note. Restoring a note preserves its original capture date.
- Bucket suggestions use note text only. Context is always user-written; dictation adds only the transcript.

## Mobile and Shortcuts

On iPhone, open the Vercel URL in Safari → Share → Add to Home Screen. Mobile navigation uses Box/Reviewed and a bucket selector; optional capture fields are collapsed. Pop idea and Find out occupy equal halves of the action row. External search behavior is controlled by the browser and OS. Dictation requires browser/device support and microphone permission; keyboard dictation is a fallback.

The desktop sidebar and Settings include the [shared iPhone Shortcut](https://www.icloud.com/shortcuts/5a8a5621902f4eeca0a761355b0d7e83). Settings lets each authenticated user create/revoke a personal, create-only token. **Copy authorization** includes the required Bearer prefix; paste it into the template's blank Authorization header. POST JSON to `/api/ideas` with `Authorization: Bearer YOUR_CAPTURE_TOKEN`. Owner and capture time are set by the database. The raw token is shown once; only its hash is stored. The Shortcut can also save captures first in an on-device outbox and sync them later through `/api/sync`; see [capture implementation details](docs/SHORTCUTS.md#offline-outbox).

On supported iPhones, assign **Idea Queue** under **Settings → Action Button → Shortcut**. The shared template intentionally contains no user's authorization.

The capture JSON accepts only `text` (required), `context`, `category`, `priority`, and `color`. Extra fields return HTTP 400; do not send `user_id`, an ID, capture dates, reviewed status, or empty placeholder fields from the Shortcut editor. The database supplies ownership and capture time. Successful capture returns HTTP 201 with the new note's ID and timestamp.

## Validation

Run `npm test` and `npm run build` for automated checks and the production build. `supabase/shortcuts.test.sql` exercises two-account isolation, token ownership, revocation, and capture defaults in an isolated PostgreSQL database; its fixtures roll back. It is a psql test script, not part of production setup. Phone and desktop browser checks verified the sign-in gate, upcoming-note behavior, installer link, complete authorization clipboard value, and absence of token persistence in browser storage. Physical iPhone dictation and Action Button behavior depend on device setup.

## Source layout

- `src/App.tsx`: responsive box, capture sheet, upcoming note, and reviewed tray.
- `src/lib/useIdeas.ts`: authenticated note reads/writes and account transitions.
- `src/lib/supabase.ts`: Google sign-in and PKCE session handling.
- `supabase/schema.sql`: notes, row-level security, indexes, atomic pop.
- `supabase/setup.sql`: combined database installation script for a new deployment.
- `supabase/shortcuts.sql`: private token hashes and narrowly scoped capture functions.
- `supabase/shortcuts.test.sql`: transactional account/token privacy checks.
- `api/ideas.ts`: Vercel create-only capture endpoint.
- `api/sync.ts`: Vercel endpoint for a local Shortcut outbox.

The previous ChatGPT Sites app uses Cloudflare D1 and its private Sites access boundary. Its worker, migration history, and `npm run build:sites` command remain for reference; they are not the Vercel database/API. Old source and SQLite files stay preserved locally and are not published. Original requirements are in `docs/original-spec.md`.
