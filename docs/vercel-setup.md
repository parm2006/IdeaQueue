# Complete Supabase + Google setup

Vercel and GitHub are already connected. Production and preview environment variables contain the Supabase project URL and **public publishable key**. The app does not use a secret/service-role key, Firebase, or a database password.

## 1. Install the database

Open your project's [SQL Editor](https://supabase.com/dashboard/project/dquvseewesuohewzpldf/sql/new).

Copy the entire contents of `supabase/setup.sql` into a new query and click **Run**. This creates the notes table, account isolation policies, atomic pop function, and optional create-only Shortcut tokens. The database starts empty; old test notes are not migrated.

Each note belongs to `auth.uid()`. Signed-out clients cannot read or write the notes table; authenticated clients can read/insert/update only their own rows. The pop function runs with the caller's permissions. Shortcut tokens live in a private schema and can only insert a new note for their owner. Revoking a token disables further capture.

## 2. Create a Google OAuth client

Sign into [Google Cloud](https://console.cloud.google.com/) as `parth@mohnot.com`. Select a project you own or create a new project. The inaccessible `elegant-tendril-zxvsd` project in your screenshot is not required.

Open **Google Auth Platform**:

1. **Branding:** set the app name to IdeaQueue and enter your contact email.
2. **Audience:** use External if you want accounts outside your Google Workspace organization to sign in. While in Testing, add `parth@mohnot.com` and any other test accounts. To let other Google accounts join, publish the consent app to Production when ready.
3. **Data Access:** use only `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile`.
4. **Clients → Create client → Web application.**
5. Authorized JavaScript origin: `https://ideaqueue.vercel.app` (use the actual production address if Vercel assigns a different alias).
6. Authorized redirect URI: `https://dquvseewesuohewzpldf.supabase.co/auth/v1/callback`.
7. Copy the client ID and client secret into **Supabase → Authentication → Sign In / Providers → Google**, enable Google, and save. Keep the client secret in that provider setting; do not put it in the frontend, GitHub, or chat.

See [Supabase's Google provider instructions](https://supabase.com/docs/guides/auth/social-login/auth-google).

## 3. Allow the return to Vercel

In [Supabase Authentication URL Configuration](https://supabase.com/dashboard/project/dquvseewesuohewzpldf/auth/url-configuration):

- Site URL: `https://ideaqueue.vercel.app`.
- Redirect URLs: `https://ideaqueue.vercel.app` and `https://ideaqueue.vercel.app/`.
- For local development only, add `http://localhost:5173` and `http://localhost:5173/`.

Use the actual production alias if it differs. Google redirects to Supabase first; Supabase then returns to the allowed Vercel origin. Preview URLs need their own allowed redirect entries if you want to test sign-in on previews.

## 4. Verify sign-in

Open the Vercel site, choose **Continue with Google**, and save a note. Open the same URL on your phone and sign into the same Google account. A second account should start with an empty box and should not see the first account's notes. Signed-out visitors can see the sign-in page; notes require authentication and database authorization.

## 5. Set up your personal Shortcut (optional)

After signing in, open Settings → Capture with iOS Shortcuts → Create capture token → Copy authorization. Install the linked Idea Queue Shortcut, then paste the copied value into Get Contents of URL → Headers → Authorization. The copied value includes `Bearer `; it is shown once and is not stored in browser storage. On supported iPhones, choose Idea Queue under Settings → Action Button → Shortcut.

Use Dictate Text, then Get Contents of URL:

```text
URL: https://ideaqueue.vercel.app/api/ideas
Method: POST
Content-Type: application/json
Authorization: Bearer YOUR_CAPTURE_TOKEN
```

JSON body: `{"text":"Your dictated thought","priority":5}`. Bucket is inferred from text when omitted. Date/hour come from the database; context remains blank unless supplied. This endpoint cannot list, read, edit, or pop existing notes. Revoke a token in Settings if you stop using that Shortcut. For disconnected Action Button capture, configure the on-device outbox and `/api/sync` flow in [the Shortcut guide](SHORTCUTS.md#offline-outbox).

## Key handling

The publishable key is designed for browser use; row-level security protects the data. Rotate the privileged secret key that was shared in chat under Supabase Settings → API Keys. The deployed app does not need that key, so rotating it will not require a deployment change.

The public key cannot install SQL or configure OAuth. To automate those admin steps in a later session, a Supabase Management API access token would be needed through a secure local credential flow; the project secret key is a different credential.
