# Capture from iOS Shortcuts

Install the [shared Idea Queue Shortcut](https://www.icloud.com/shortcuts/5a8a5621902f4eeca0a761355b0d7e83) from the desktop sidebar or Settings → Capture with iOS Shortcuts. This template has a blank Authorization header and no import questions. After installing, edit **Get Contents of URL → Headers → Authorization** and paste the entire value copied by **Copy authorization**, including `Bearer `. Do not paste only the raw token.

On an iPhone with an Action button, open **Settings → Action Button → Shortcut → Idea Queue**. [Apple's Action button guide](https://support.apple.com/guide/iphone/use-and-customize-the-action-button-iphe89d61d66/ios) describes this setting.

To make a future template ask for authorization during installation, add a setup/import question to the Shortcut on your iPhone and share that version. Keep the default answer blank; recipients paste their own authorization. Shared iCloud copies cannot be edited by this website. See [Apple's import-question guide](https://support.apple.com/en-ca/guide/shortcuts/apdf330fd3a0/ios).

Database setup: run `supabase/schema.sql`, then `supabase/shortcuts.sql` in your project's SQL Editor. The second file is transactional. It uses Supabase's pgcrypto extension in the `extensions` schema.

Vercel needs `SUPABASE_URL` and `SUPABASE_ANON_KEY`, using the same project URL and public publishable/anon key as the frontend. The handler also accepts the frontend `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` variables. Do not supply a service-role key.

Sign into IdeaQueue and create a Shortcut token in Settings. Copy authorization when it appears; the copied value includes the required Bearer prefix. Only the token's SHA-256 hash remains in the database, so it cannot be shown again. Each token belongs to the account that created it. Revoke a token in Settings if you stop using the Shortcut.

In Apple's Shortcuts:

1. Add **Dictate Text** or **Ask for Input**.
2. Add **Get Contents of URL**, pointing to `https://YOUR-VERCEL-DOMAIN/api/ideas`.
3. Choose **POST**, with a **JSON** request body.
4. Set headers `Authorization: Bearer YOUR_CAPTURE_TOKEN` and `Content-Type: application/json`.
5. Set the JSON field `text` to your dictated/input text. Optionally set `priority` (integer 1–10), `category`, `color`, or your own `context`.

The bucket defaults from the idea text, priority defaults to 5, color defaults to yellow, and context remains empty unless you supply it. The database supplies the capture date and time. A successful response has status 201 and contains only the new note's ID and timestamp.

A Shortcut token grants permission to create notes for its owner. It cannot list, edit or pop notes, impersonate another account, or manage other tokens. Do not put it in a public URL or shared Shortcut. The public Supabase key itself grants no note access. Invalid/revoked capture tokens return 401. The endpoint intentionally does not enable browser cross-origin requests; Shortcuts sends a native HTTP request.

Token RPCs are `create_shortcut_token(p_label)`, `list_shortcut_tokens()`, and `revoke_shortcut_token(p_id)` for signed-in accounts. The capture RPC is `capture_idea_with_token`; it validates the opaque bearer token, sets ownership itself, and returns only a new-note receipt. Its hashes live in an unexposed private schema with no user grants. Revocation and capture lock the same token row so revocation is honored by subsequent writes.

Validation: `src/lib/captureApi.test.ts` covers API methods, bearer authorization, input limits, identity spoofing and sanitized failures. `supabase/shortcuts.test.sql` checks real PostgreSQL grants and two-account isolation, wrong/revoked tokens, private hash storage, and defaults. Run that SQL only against an isolated scratch database with synthetic auth users; it rolls back all fixtures.
