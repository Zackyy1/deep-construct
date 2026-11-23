# The office

A 2D office where you talk to the deep-construct orchestrator and watch the team work.

```bash
node office/server.mjs --project ~/path/to/your-app   # then open http://127.0.0.1:4317
```

- `--project` must be a deep-construct project (create one with `node harness/bin/init.mjs <dir>`).
  Without it the office runs in demo mode.
- `--model` sets the orchestrator's model (default `opus`), `--port` the port (default 4317).

## How it works

The server starts **your own installed `claude`** inside the project as the orchestrator:
headless, streaming JSON both ways, logged in with your own account. The office never sees
or stores credentials.

- **No permission prompts.** Claude runs with `--permission-mode bypassPermissions` so agents
  never stop to ask. The engine's guard hooks still run and still block what `core/RULES.md`
  forbids. `DC_MAINTAINER` is never passed to the child process.
- **Questions reach you.** When the orchestrator uses AskUserQuestion (brand, money, data loss
  and the other critical decisions), it shows up as a card in the console.
- **The office mirrors the work.** A running `dc-*` subagent puts that agent at its desk, with
  its current tool call as the label. When the subagent finishes, the agent is free again.
  The orchestrator works whenever it's taking a turn.
- **Usage** shows your plan's 5-hour and weekly windows, as Claude reports them, plus the
  API-equivalent cost of the session.
- Every request runs in a fresh Claude session, so the orchestrator never re-reads earlier
  conversations. Messages typed while it is still working join the current request. A short
  summary of the last request (what you asked, its final reply) is kept in `office/.data/`
  (gitignored) and handed to the next session, so a follow-up like "yes, do that" still works.

The API only accepts requests from the office page itself (Host, Origin and JSON content-type
checks), because whoever can send a prompt can make Claude run commands.

## Layout

| Path | What |
|---|---|
| `server.mjs` | entry point: static files + API |
| `lib/claude-session.mjs` | runs `claude`, answers questions, interrupts |
| `lib/normalize.mjs` | claude stream-json → office events |
| `lib/api.mjs` | `/api/events` (SSE), `/api/prompt`, `/api/answer`, `/api/interrupt` |
| `public/js/bridge-state.js` | the event reducer, shared by server and browser |
| `public/js/office-sync.js` | who is working, from the bridge state |
| `public/js/*` | the 2D world: layout, agents, camera, rendering, console |

Tests: `npm --prefix office test`. Sprites: PixelOfficeAssets by 2dPig (CC0).
