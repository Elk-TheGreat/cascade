# Cascade

A self-hosted visual automation studio: build workflows on a node canvas, run real
Python and JavaScript, drive a browser or a desktop session, put workflows on a
cron schedule, receive webhooks, and generate a first draft of a workflow from a
plain-English description.

Everything runs in one Node process. State lives in a local SQLite file
(`node:sqlite`, no database server).

---

## Quick start

```bash
npm install          # also fetches Playwright Chromium on first install
npm run dev          # http://localhost:5177
```

`npm run dev` starts the server and Vite in middleware mode on the same port, so
there is one URL and no CORS setup. The database is created and seeded with three
example workflows the first time it starts.

For a production-style run:

```bash
npm run build        # writes public/
npm start            # NODE_ENV=production, serves public/ + /api on PORT (5177)
```

### Environment

| Variable              | Default            | Purpose                                        |
| --------------------- | ------------------ | ---------------------------------------------- |
| `PORT`                | `5177`             | HTTP port                                      |
| `CASCADE_DATA_DIR`    | `./data`           | SQLite database + run artefacts                |
| `CASCADE_PYTHON`      | `python3`          | Interpreter used by Python nodes               |
| `CASCADE_DISPLAY`     | `:99`              | X display used by desktop nodes                |
| `OPENAI_API_KEY`      | —                  | Enables AI generation (OpenAI-compatible)      |
| `OPENAI_BASE_URL`     | `https://api.openai.com/v1` | Point at any compatible gateway       |
| `OPENAI_MODEL`        | `gpt-4o-mini`      | Model for AI nodes and generation              |
| `ANTHROPIC_API_KEY`   | —                  | Enables AI generation (Messages API)           |
| `ANTHROPIC_MODEL`     | `claude-sonnet-4-5`| Model for AI nodes and generation              |

API keys can also be added in **Connections** (masked, encrypted at rest with
AES-256-GCM); a saved connection takes precedence over the matching env var.

---

## What you get

### Node canvas

React Flow canvas with a searchable palette, drag-and-drop, multi-select,
edge routing, live per-node status badges (running / success / error / skipped),
an inspector for the selected node, and keyboard shortcuts (`Ctrl/Cmd+S` save,
`Ctrl/Cmd+Enter` run, `Ctrl/Cmd+D` duplicate, `Delete` remove, `Esc` deselect).

### Node types

| Category    | Nodes |
| ----------- | ----- |
| Triggers    | Manual start, Schedule, Webhook |
| Core        | JavaScript, Python, HTTP request, Condition, Transform, Delay, For each, Run workflow (sub-workflow) |
| Browser     | Browser — a persistent Playwright session per run: goto, click, fill, type, press, hover, select, wait, extract text/html/attribute, evaluate, scroll, viewport, screenshot, close |
| Desktop     | Desktop — via Xvfb + xdotool: screenshot, move/click/double-click/right-click, type, key combos, scroll, launch a command, activate or wait for a window |
| Integrations| Custom integration, Slack message, Discord message, Send email |
| AI          | AI prompt (uses your configured provider) |

### Data between nodes

Values flow through a small expression language available in every field:

```
{{ input.stars }}
{{ steps.fetch.body.full_name }}
{{ item.email }}
{{ trigger.type }}
```

JavaScript and Python nodes receive `input` (previous step output), `item`/`index`
(inside a For each), `steps` (all outputs so far), `trigger`, and `vars`, and
return a JSON-serialisable result. Both run in a sandboxed child process with a
wall-clock timeout, so a runaway script cannot hang the engine.

Conditions pass data through and tag it with `condition: { result, branch }`;
For each fans out over arrays; Run workflow calls another workflow and waits for
its result.

### Runs

Every run is persisted step by step (`runs`, `run_nodes`, `run_logs`). The editor's
run console streams over SSE and falls back to polling, so it stays truthful even
behind a buffering proxy. Any run can be replayed from the Runs page, and can be
started again or cancelled from there.

### Scheduling

The Schedules page binds a workflow to a cron expression. Expressions are
validated before they are saved (`cron-parser`), shown with their next run time,
and fired by `node-cron`. Scheduled runs appear in the same run history as manual
ones.

### Webhooks

Each workflow with a Webhook trigger gets a token; `POST /api/hooks/<token>` with
any JSON body starts a run and the body becomes the trigger input. Unknown tokens
are rejected with 401.

### AI generation

The AI dialog turns a description ("every morning, fetch this RSS feed and post a
summary to Slack") into a node graph laid out on the canvas, with node types,
sensible fields and edges filled in. Without an AI key it falls back to a local
heuristic planner, so the feature never blocks you. Applying a plan over an
existing graph asks for confirmation first.

---

## Layout

```
server/
  index.js         Express app: API, SSE, static serving, dev middleware
  db.js            SQLite schema (workflows, runs, run_nodes, run_logs, credentials, schedules)
  store.js         Query helpers
  graph.js         Graph normalisation/validation + catalog payloads
  runs.js          Run registry, SSE broadcast/subscribe, persistence
  scheduler.js     Cron registration
  credentials.js   Encrypted credential storage, masked reads
  generation.js    AI plan → graph
  engine/
    executor.js    Topological traversal, retries, loops, sub-workflows, events
    catalog.js     Node definitions + defaults
    expr.js        Expression evaluator and template rendering
    sandbox.js     Out-of-process JS/Python execution
    browser.js     Playwright actions
    desktop.js     xdotool/ImageMagick actions
    ai.js          Provider calls
client/src/
  App.jsx          Shell, hash routing, nav
  components/      Editor, Palette, Inspector, RunConsole, FlowNode, AiDialog
  pages/           Workflows, Runs, Schedules, Connections
  api.js           Typed-ish API client
```

## Desktop automation prerequisites

Desktop nodes drive a real X session: install `xdotool` and `imagemagick`, and have
an X server reachable at `CASCADE_DISPLAY` (e.g. `Xvfb :99 -screen 0 1440x900x24`).
Browser screenshots and desktop screenshots are written to `data/files/` and
served from `/files/…`.
