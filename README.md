# IdeaQueue

A responsive sticky-note idea box for phone and desktop. One **Add idea** button captures typed or dictated thoughts. The highest-priority note stays visible; **Pop idea** reviews it and shows the next note. **Find out ↗** searches Google for that note's text.

The Vercel app uses **Supabase Postgres + Supabase Auth with Google OAuth**. Everyone signs into their own account; row-level security isolates their notes. Firebase is not used. Signed-out visitors get a sign-in screen. There is no anonymous note workspace or browser-only fallback.

## Finish account setup

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

Settings lets each authenticated user create/revoke a personal, create-only Shortcut token. POST JSON to `/api/ideas` with `Authorization: Bearer YOUR_CAPTURE_TOKEN`. Owner and capture time are set by the database. The raw token is shown once; only its hash is stored. See [setup instructions](docs/vercel-setup.md) and [capture implementation details](docs/SHORTCUTS.md). Saving requires a connection; there is no offline cloud-write queue.

## Source layout

- `src/App.tsx`: responsive box, capture sheet, upcoming note, and reviewed tray.
- `src/lib/useIdeas.ts`: authenticated note reads/writes and account transitions.
- `src/lib/supabase.ts`: Google sign-in and PKCE session handling.
- `supabase/schema.sql`: notes, row-level security, indexes, atomic pop.
- `supabase/shortcuts.sql`: private token hashes and narrowly scoped capture functions.
- `supabase/shortcuts.test.sql`: transactional account/token privacy checks.
- `api/ideas.ts`: Vercel create-only capture endpoint.

The previous ChatGPT Sites app uses Cloudflare D1 and its private Sites access boundary. Its worker, migration history, and `npm run build:sites` command remain for reference; they are not the Vercel database/API. Old source and SQLite files stay preserved locally and are not published. Original requirements are in `docs/original-spec.md`.
