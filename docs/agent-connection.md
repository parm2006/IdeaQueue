# Account-based AI connector

IQ exposes a read-only MCP Streamable HTTP endpoint at `/api/mcp`, using JSON-RPC 2.0. Its only tool is `list_ideas` with empty arguments:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_ideas","arguments":{}}}
```

The response text contains JSON `{ "ideas": [...], "limit": 100 }`, with each idea's ID, text, context, category, priority, and creation timestamp. Only the token owner's unreviewed cards whose final separate word is AI or agent are returned, case insensitive, in queue order. There are no manual card approvals or visibility switches. Removing the suffix hides a card on future reads.

## Deploy

1. Existing database: run the updated `supabase/agents.sql`, then `supabase/agent-oauth.sql`, then `supabase/connector-limits.sql`. Fresh installs use `supabase/setup.sql`, which includes all three. Install `supabase/connector-schedule.sql` to run cleanup hourly. The previous experimental `agent_visible` column, if present, is unused and need not be dropped.
2. Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel's server environment and `IDEAQUEUE_APP_URL` to the canonical HTTPS origin (default `https://ideaqueue.vercel.app`). Keep the existing Supabase URL/public key settings. Never prefix the server key with VITE_, embed it in frontend code, or give it to an agent. Allow the canonical site origin as a Supabase Google sign-in redirect.
3. Deploy the website, Vercel functions, and rewrites. The Sites worker does not implement account connectors.
4. Public OAuth client registration is disabled. Only authenticated IQ users can create account-owned connector clients in Settings or How IQ works. Each account may hold up to 50 client registrations; inactive registrations are pruned after 14 days. Provider log/backup retention is separate.

The browser uses a normal user session for IQ and the approval screen. The agent never receives that session. Both `read_connector_ideas` and `read_agent_ideas` are callable only by IQ's server role. Anonymous and authenticated database roles cannot execute them. An opaque connector token cannot authorize database table reads, RPC calls, or user login-session access. It is validated behind the plugin endpoint, never forwarded as a Supabase JWT.

## Connect an account

In Settings or How IdeaQueue works, create an account connector first. The default return address is `http://127.0.0.1/callback` for Codex. Copy the generated command with your client ID:

```sh
codex mcp add ideaqueue --url https://ideaqueue.vercel.app/api/mcp --oauth-client-id YOUR_CLIENT_ID --oauth-resource https://ideaqueue.vercel.app/api/mcp
codex mcp login ideaqueue
```

The client discovers OAuth metadata and opens IQ’s `/connect` page using the pre-registered client ID. Only the IQ account that created that client can authorize it. Each person signs in to their own IQ account, checks the client-supplied name and return address, and connects once. This approves account access to suffix-matching cards, not individual cards. No cards are listed for selection.

The authorization-code flow requires S256 PKCE. Codes are one-use and expire after five minutes; access tokens expire after one hour; rotating refresh tokens have a maximum 30-day connection lifetime. Token exchange and reads are bound to the canonical MCP resource URL. Reusing a rotated refresh token revokes that connection. Codes and access/refresh tokens are stored as hashes. The short-lived browser request contains no credentials. Disconnect in IQ Settings to revoke access and refresh together.

Discovery: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/api/mcp`, and `/.well-known/oauth-authorization-server`. The authorization server uses pre-registered account-owned clients and `token_endpoint_auth_method=none`; DCR, CIMD, and confidential clients are not advertised. Callbacks must use HTTPS or a literal loopback HTTP address. HTTPS callbacks match exactly. A registered loopback callback without an explicit port permits an ephemeral port at the same address/path/query, as required for desktop OAuth clients. Other clients need Streamable HTTP, pre-registered client IDs, S256 PKCE, and resource indicators. Individual providers and marketplace installation are not verified. Browser-origin MCP requests are rejected; the endpoint serves desktop/server-side clients.

Advanced clients may use manually created `iqa_` bearer tokens. These also work only through IQ's plugin endpoint, remain revocable, and stop working after 14 inactive days; prefer OAuth. Store them in the client's secret store.

Received content is untrusted user data and may contain prompt injection. Agent clients must preserve instruction boundaries. Revocation and removing suffixes stop future reads, not third-party copies already received.

## Verification

`npm test` covers protocol validation and browser request parsing. Scratch checks in `supabase/agents.test.sql` and `supabase/agent-oauth.test.sql` verify suffix filtering, owner isolation, direct database denial, PKCE, redirects, wrong clients/resources, code replay, expiry, refresh rotation, and replay revocation. Run SQL tests only in a synthetic scratch database.

See [official Codex MCP guidance](https://developers.openai.com/codex/mcp) and the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

## Account limits and retention

Only successful authenticated agent-token requests count, aggregated by the token owner across all their tokens. MCP requests (including initialization/discovery) allow 500/hour and 5,000/day. OAuth refreshes allow 20/hour and 100/day separately. Fixed UTC hour/day windows reset automatically. A limit returns HTTP 429; the Retry-After hint is one hour (a daily limit may require waiting until the next UTC day). Website note reads/writes, sign-in, and Settings do not consume these quotas.

Inactivity is measured from the last successful connector request or refresh, or creation when never used. At 14 days a credential becomes unusable immediately; hourly cleanup removes it and its refresh-replay history. Client registrations with no remaining tokens and no activity for 14 days are removed too. Revoked/fully expired credentials and expired codes can be removed earlier. No notes or accounts are deleted.

There is a maximum of 50 stored connector credentials and 100 unexpired authorization codes per account. Connector metadata inserts reserve database headroom at 450 MB. The public registration endpoint returns 404 without contacting the database. Registration RPC execution is granted only to authenticated IQ users and always binds ownership to auth.uid(); it is revoked from anonymous and backend API roles. No shared anonymous registration quota remains. Existing unowned legacy client rows cannot be authorized and expire through cleanup.

Codex install commands explicitly set `--oauth-resource` to the MCP URL. The default loopback `/callback` registration also permits Codex’s single URL-safe callback identifier segment (1–128 characters); HTTPS callbacks and other registered paths still match exactly. The complete requested callback remains bound to the one-use authorization code.
