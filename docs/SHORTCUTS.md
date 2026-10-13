# Capture from iOS Shortcuts

Install the [shared Idea Queue Template](https://www.icloud.com/shortcuts/ace61478ef2547c68fb6341b2e522e24) from the desktop sidebar or Settings → Capture with iOS Shortcuts. This template saves thoughts locally, syncs when run on Wi-Fi, and clears the queue after confirmed success. Its Authorization header is blank. After installing, edit **Get Contents of URL → Headers → Authorization** and paste the entire value copied by **Copy authorization**, including `Bearer `, as plain text without leading/trailing whitespace. Do not paste only the raw token.

On an iPhone with an Action button, open **Settings → Action Button → Shortcut** and select the installed Idea Queue Template (or rename it Idea Queue). [Apple's Action button guide](https://support.apple.com/guide/iphone/use-and-customize-the-action-button-iphe89d61d66/ios) describes this setting.

To make a future template ask for authorization during installation, add a setup/import question to the Shortcut on your iPhone and share that version. Keep the default answer blank; recipients paste their own authorization. Shared iCloud copies cannot be edited by this website. See [Apple's import-question guide](https://support.apple.com/en-ca/guide/shortcuts/apdf330fd3a0/ios).

Database setup: run `supabase/schema.sql`, then `supabase/shortcuts.sql` in your project's SQL Editor. The second file is transactional. It uses Supabase's pgcrypto extension in the `extensions` schema.

Vercel needs `SUPABASE_URL` and `SUPABASE_ANON_KEY`, using the same project URL and public publishable/anon key as the frontend. The handler also accepts the frontend `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` variables. Do not supply a service-role key.

Sign into IdeaQueue and create a Shortcut token in Settings. Copy authorization when it appears; the copied value includes the required Bearer prefix. Only the token's SHA-256 hash remains in the database, so it cannot be shown again. Each token belongs to the account that created it. Revoke a token in Settings if you stop using the Shortcut.

For an online-only Shortcut using the separate `/api/ideas` endpoint:

1. Add **Dictate Text** or **Ask for Input**.
2. Add **Get Contents of URL**, pointing to `https://YOUR-VERCEL-DOMAIN/api/ideas`.
3. Choose **POST**, with a **JSON** request body.
4. Set headers `Authorization: Bearer YOUR_CAPTURE_TOKEN` and `Content-Type: application/json`.
5. Set the JSON field `text` to your dictated/input text. Optionally set `priority` (integer 1–10), `category`, `color`, or your own `context`.

The bucket defaults from the idea text, priority defaults to 5, color defaults to yellow, and context remains empty unless you supply it. The database supplies the capture date and time. A successful response has status 201 and contains only the new note's ID and timestamp.

Only `text`, `context`, `category`, `priority`, and `color` are accepted in the JSON body. Remove extra or blank placeholder fields: unknown fields return HTTP 400. Do not send a user ID, note ID, capture date, or reviewed status. The shared template's authorization is intentionally blank; each installed personal copy needs its owner's complete Bearer value.

## Offline outbox

The shared template includes the complete offline flow; recipients do not need to assemble it. On first use, grant file permissions and select their own **On My iPhone** destination in **Create Folder** if the imported folder reference is unavailable. The queue is local; it does not require iCloud Drive.

1. **Create Folder** creates/reuses `On My iPhone/IdeaQ`; its output is stored as `QueueFolder`.
2. The type/dictate menu stores `IdeaText`. A **Dictionary** with one `text` entry is converted to Text, so quotation marks and line breaks in thoughts are escaped as JSON.
3. **Get File from QueueFolder** at `outbox.txt` has **Error If Not Found** off. If a file is returned, **Append to Text File** appends the dictionary Text with **Make New Line** on. Otherwise, **Save File** creates `outbox.txt` from that Text without overwriting existing files.
4. After saving locally, **Get Wi-Fi Network Name → If Network Details has any value** runs the sync branch. This reads the complete `outbox.txt` and POSTs its Text as the sole `outbox` field:

   ```text
   URL: https://ideaqueue.vercel.app/api/sync
   Method: POST
   Headers:
     Content-Type: application/json
     Authorization: Bearer YOUR_CAPTURE_TOKEN
   JSON body:
     {"outbox": Contents of File}
   ```

5. **Get Dictionary Value** reads `saved` from the response. An **If**, treating it as a Number, checks **greater than 0**. Only then does **Save File** overwrite `outbox.txt` with a blank line. The file remains in place for future capture; no manual clearing is needed. Failed requests retain the queue.

Sync happens when the Shortcut is run on Wi-Fi. Joining Wi-Fi alone does not trigger it, and cellular alone does not sync. A Wi-Fi connection does not guarantee internet access. Capture another thought on working Wi-Fi to retry the saved queue. The template always opens its capture menu; it does not implement a separate sync-only input.

The database checks capacity before writes. When the storage guard rejects a note or Supabase is read-only/full, the API returns HTTP 507 with an error and no `saved` count. The template retains the entire local queue. Only `saved > 0` clears it. Reviewed cloud notes are permanently deleted by the hourly cleanup; pending notes and the phone's outbox are preserved.

`POST /api/sync` accepts up to 50 newline-separated JSON captures at a time and uses the same create-only token checks as `/api/ideas`. It validates the entire local file before making any writes, then returns `201 {"saved": number}` when every capture was accepted. Queues exceeding 50 ideas or 64 KiB are rejected and retained. A partial server failure or interruption after saving but before the phone receives the response can cause duplicates on retry; sync is not an atomic or deduplicated batch.

A Shortcut token grants permission to create notes for its owner. It cannot list, edit or pop notes, impersonate another account, or manage other tokens. Do not put it in a public URL or shared Shortcut. The public Supabase key itself grants no note access. Invalid/revoked capture tokens return 401. The endpoint intentionally does not enable browser cross-origin requests; Shortcuts sends a native HTTP request.

Token RPCs are `create_shortcut_token(p_label)`, `list_shortcut_tokens()`, and `revoke_shortcut_token(p_id)` for signed-in accounts. The capture RPC is `capture_idea_with_token`; it validates the opaque bearer token, sets ownership itself, and returns only a new-note receipt. Its hashes live in an unexposed private schema with no user grants. Revocation and capture lock the same token row so revocation is honored by subsequent writes.

Validation: `src/lib/captureApi.test.ts` covers API methods, bearer authorization, input limits, identity spoofing and sanitized failures. `supabase/shortcuts.test.sql` checks real PostgreSQL grants and two-account isolation, wrong/revoked tokens, private hash storage, and defaults. Run that SQL only against an isolated scratch database with synthetic auth users; it rolls back all fixtures.
