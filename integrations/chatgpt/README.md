# EyeMyHealth in ChatGPT

ChatGPT connects to the same MCP server as Claude. There is no skill format in ChatGPT, so the guidance lives in the app description and instructions below, and in the tool descriptions themselves (which are written to stand on their own).

- **MCP server URL:** `https://eyemyhealth.com/mcp`
- **Transport:** Streamable HTTP (stateless, JSON responses)
- **Authentication:** OAuth 2.1, authorization-code + PKCE (S256), dynamic client registration. Discovery: `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.
- **Scopes:** `health:read`, `health:log`, `health:write`, `family:manage` (the person ticks what to allow on the consent screen).
- **ChatGPT-specific tools:** `search` and `fetch` follow the shapes ChatGPT's connectors and deep research expect; the other tools work as normal actions.

## Set it up (developer mode)

1. In ChatGPT, open Settings > Apps/Connectors > Advanced > enable Developer mode.
2. Create a connector. Name: `EyeMyHealth`. URL: `https://eyemyhealth.com/mcp`. Authentication: OAuth.
3. Sign in with Google or Apple on the EyeMyHealth page that opens, choose what to allow, and tick the sharing box.
4. In a chat, enable the connector and ask, for example, "What changed in my last two lab reports?"

Menu names change between ChatGPT releases; follow the current ChatGPT documentation for connectors if they differ.

## Description (for the app listing)

> Ask about your own EyeMyHealth records - lab results and trends, medicines and doses, diet, water, workouts, retests and insurance cover - and log water, meals and doses. Your data stays in EyeMyHealth; the connector only returns what you allow, and you can disconnect it any time in EyeMyHealth > Settings > Connected AI apps. Not medical advice.

## Instructions (paste into the app's instructions field)

```
You can read and update the user's own EyeMyHealth records through this connector.

- Always use the tools; never guess values, dates or ranges. If nothing is found, say so.
- Cite the report (file name and date) behind every number. Give value, unit, date and range.
- Explain in plain language. Do not diagnose or tell the user to start, stop or change a medicine or dose; suggest discussing it with a clinician.
- If the user describes an emergency (chest pain, trouble breathing, stroke signs, severe bleeding, self-harm), tell them to contact emergency services now, before anything else.
- For a family member, call list_profiles and pass profileId on later calls. Ask which person if unclear.
- Log only what the user states (water, meals, doses, weight). Ask before edits.
- Deletes are two-step: call with only the id to get a summary and confirmationToken, show the summary, and call again with the token only after the user clearly confirms.
- You cannot upload files. Call create_upload_link and give the user the one-time link.
- If a tool returns consent_required, tell the user to turn on "Other AI apps" in EyeMyHealth > Settings > Privacy & AI.
```

## Not verified

These steps and the instruction text were written against the MCP and OAuth specifications and tested with the MCP SDK client and automated tests. They have not been run against the live ChatGPT product. Before publishing, test the full flow in ChatGPT developer mode and against the current app-submission requirements.
