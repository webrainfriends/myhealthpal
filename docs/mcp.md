# EyeMyHealth as an MCP connector (Claude and ChatGPT)

Everything the app does for a person - reading reports and trends, medicines, diet, water, workouts, retests, insurance, family profiles - is also available to AI assistants through a **remote MCP server** at `/mcp`, signed in with **OAuth 2.1**. Claude gets a skill that teaches it to use the tools well; ChatGPT uses the same server (see `integrations/chatgpt/README.md`).

- Tool reference (generated from the code): [`mcp-tools.md`](mcp-tools.md)
- Claude plugin and skill: `integrations/claude/eyemyhealth/`
- ChatGPT setup and instructions: `integrations/chatgpt/README.md`

## How it fits together

```
 Claude / ChatGPT ──MCP (Streamable HTTP, JSON)──▶  nginx  ──▶  Express API (same process as the app's REST API)
        │                                                          │
        └──OAuth 2.1 + PKCE (register, authorize, token)───────────┤
                                                                   ├─ oauth/        clients, grants, codes, tokens (hashed)
 App (Expo) ──REST /api──────────────────────────────────────────▶ ├─ mcp/          gateway: scope → rate limit → profile → consent → audit → tool
                                                                   ├─ shared services (REST routes and MCP tools call the same code)
                                                                   └─ PostgreSQL · encrypted vault (KMS) · append-only audit log
```

Paths (all proxied to the API by nginx): `/mcp`, `/oauth/*`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/mcp-upload/*`.

## Connecting

1. The user adds the connector in Claude or ChatGPT with the URL `https://eyemyhealth.com/mcp`.
2. The client registers itself (`POST /oauth/register`) and opens `/oauth/authorize`.
3. The user signs in with Google or Apple on that page. Only **existing** EyeMyHealth accounts can connect - the connector is not a back door around the sign-up cap.
4. They choose which permissions to allow and tick the box that shares their data with the AI app (this records the `external_ai_connector` consent for their own profile).
5. The client receives an access token (about 1 hour) and a rotating refresh token.

Users see and disconnect their connections in the app: **Settings > Connected AI apps**. Disconnecting revokes the tokens immediately.

## Scopes

| Scope | Allows |
| --- | --- |
| `health:read` | Everything read-only |
| `health:log` | Log water, meals, doses, weight, height, activity, retest check-ins |
| `health:write` | Edits, upload links and permanent deletes (two-step) |
| `family:manage` | Sponsor/caretaker summary across supported people |

A tool the grant does not allow is not even listed, and is refused if called.

## Security model

Every tool call goes through one gateway (`server/src/mcp/gateway.js`):

1. **Token** - opaque, hashed at rest, short-lived; the app's own 180-day session token is not accepted on `/mcp`.
2. **Scope** - checked against the tool's declared scope.
3. **Rate limit** - per connection (default 120 calls/minute).
4. **Profile** - the model may pass `profileId`, but it only resolves through a `family_links` row, with the same rules as the app: sponsors never see full records, and **view-only links refuse every non-read-only tool**. No tool accepts a raw user id.
5. **Consent** - the person whose records are touched must have turned on `external_ai_connector`. For a family profile, that is decided in the app by whoever looks after them.
6. **Audit** - `MCP_TOOL_CALLED` / `MCP_TOOL_DENIED` with the tool name only, never arguments or results (the audit table is append-only and holds no health data).
7. **Result size cap** - oversized results are refused with a message to narrow the request.

Additional protections:

- **Deletes are two-step.** The first call changes nothing and returns a summary plus a confirmation token bound to the connection, the person, the tool and the target id; it expires in 5 minutes and works once.
- **Not exposed at all:** account deletion, consent changes, key management and admin functions.
- **Uploads** use a one-time link (`create_upload_link`): a signed, 15-minute, single-use URL to a small page that feeds the existing upload pipeline (file-type and malware checks, encrypted vault, classification). The link is re-validated when used - disconnecting the app, withdrawing consent or removing family access kills it. The path contains a credential, so nginx does not log `/mcp-upload/`.
- **Refresh tokens rotate**; reuse of an old one revokes the whole grant. A replayed authorization code does the same.
- **Redirect URIs** must be https (or loopback) and match exactly. Set `MCP_REDIRECT_HOST_ALLOWLIST` (for example `claude.ai,chatgpt.com`) to restrict which hosts clients may register.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | Public https origin; used in OAuth metadata and upload links. `deploy.yml` sets it. | `http://localhost:<PORT>` |
| `MCP_ACCESS_TOKEN_TTL_SECONDS` | Access token lifetime | 3600 |
| `MCP_REFRESH_TOKEN_TTL_DAYS` | Refresh token lifetime | 30 |
| `MCP_REDIRECT_HOST_ALLOWLIST` | Comma-separated hosts allowed as redirect targets | any https |
| `MCP_RATE_LIMIT_PER_MINUTE` | Tool calls per connection per minute | 120 |

Google and Apple sign-in on the authorize page use the same `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` as the app. **Google:** the web page needs `https://eyemyhealth.com` listed as an authorized JavaScript origin on that OAuth client. **Apple:** web sign-in needs a Services ID with the return URL configured; if that is not set up, only Google sign-in will work on the connector page.

## Developing and testing

```bash
cd server
npm run migrate                       # includes 041_oauth_mcp.sql
npm test                              # node:test against a real Postgres
node --test test/mcp.*.test.js test/oauth.flow.test.js test/routes.*.test.js
npm run mcp:docs                      # regenerate docs/mcp-tools.md after adding a tool
npx @modelcontextprotocol/inspector   # connect to http://localhost:4000/mcp (OAuth)
```

Adding a tool: create it with `readTool` / `writeTool` in `server/src/mcp/tools/`, call an existing service (add one if the logic only lives in a route - routes and tools must share it), register it in `tools/index.js`, add isolation tests, then `npm run mcp:docs`. Tests enforce that no tool exposes a user id argument, that every write tool is scoped and non-read-only, that deletes are two-step, and that the docs match the registry.

## Known limits

- No photo/file upload through the tool call itself (a remote MCP tool cannot receive a file); use `create_upload_link`.
- Live AI Workout Coach sessions (camera-based) are app-only; workout history, plans and analytics are available.
- Gmail import and notification settings are app-only.
- Diet recommendations use the app's own AI and need the person's "AI insights" consent in addition to the connector consent.
- Not exercised against the live Claude or ChatGPT products - verified with the MCP SDK client and automated tests. Test the flow in each product before publishing a listing, and expect each directory to require a privacy policy and review.
