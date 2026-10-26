# sketchdrop for DataHub

Turn a DataHub entity's lineage, or a block of plain text, into an editable Excalidraw diagram that you can download as a real `.excalidraw` file.

Built for **Build with DataHub: The Agent Hackathon** (Open / Wildcard track).

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> [!NOTE]
> This is a standalone Next.js app that **uses** [Excalidraw](https://github.com/excalidraw/excalidraw) through the MIT-licensed `@excalidraw/excalidraw` npm package. It is not a fork of the Excalidraw codebase and is not affiliated with Excalidraw or DataHub.

> [!WARNING]
> The homepage link set on this repo (`excalidraw-acc.vercel.app`) currently returns Vercel's `DEPLOYMENT_NOT_FOUND`. There is no live demo right now, so run it locally (see [Running locally](#running-locally)).

## What it does

The app has two input modes, which you switch between at the top of the page.

**Prompt mode.** Paste some text (at least 20 characters, up to 8,000 are used) and Claude returns a small JSON *spec*: title, takeaway, `flow` or `hub` layout, 4 to 10 nodes and their edges. The app's own code then validates that spec and handles all geometry, ids and the Excalidraw schema. Claude never writes coordinates. Other options:

- 2 to 5 colours, and a `sketch` or `clean` style.
- Up to 6 X handles. Each handle's avatar is fetched from [unavatar.io](https://unavatar.io) and embedded in the file.
- Three built-in examples (`zk-rollup`, `dao-gov`, `how-it-works`) that render from canned specs without calling the API.

**DataHub mode.** Search for a real DataHub entity and build a diagram from its actual metadata rather than from an LLM's guess. There are three view presets:

| Mode | Direction | Hops | Max nodes | Intended use |
|---|---|---|---|---|
| Architecture | both | 2 | 24 | onboarding, design reviews |
| Impact | downstream | 3 | 30 | schema changes; marks critical paths to dashboards and models |
| Column flow | both | 2 | 12 | column-level lineage for migrations |

You can edit the result on the canvas, download it, and open it on [excalidraw.com](https://excalidraw.com), where it can also be exported as PNG or SVG.

## How the DataHub pipeline works

1. **Search.** Free text is resolved to a URN. This step is skipped if the seed is already a URN.
2. **Traverse** (`lib/datahub/orchestrator.js`). The pipeline fetches lineage within the hop limit, then ownership, domain, tags and deprecation for all nodes in one batch. Schema fields, assertions, query traffic and related documents are fetched only for the nodes that survive the first prune.
3. **Prune** (`lib/datahub/prune.js`). Each node gets an importance score. Failing assertions, deprecation, PII fields, owners, domain and glossary terms raise it; staging/tmp/raw-style names and missing descriptions lower it. The seed is always kept. Other nodes are dropped when the score is under 0.18, when the node budget is full, or (optionally) when they look like staging tables, and dropped staging nodes are clustered. Problem nodes are boosted rather than guaranteed a place, so they can still be cut on a very tight node budget. Every keep or drop decision records a `reason`, which the UI shows in a trace panel.
4. **Layout and render** (`lib/datahub/layout.js`, `lib/datahub/excalidraw.js`). A deterministic tiered layout is mapped onto an Excalidraw scene. No LLM is involved in this step.
5. **Refine (optional)** (`/api/datahub/annotate`). Claude turns a natural-language instruction into keep/drop decisions over URNs that already exist in the graph, and suggests missing descriptions and tags. Tags must come from a fixed vocabulary: PII, Sensitive, Deprecated, Certified, Staging, Critical, Undocumented. Any URN or field not in the graph is discarded, the number rejected is returned as `rejectedForHallucination`, and the seed is never dropped.
6. **Write back (optional, off by default)** (`/api/datahub/writeback`). This applies approved `tag` and `describe` actions, or saves the diagram itself as a DataHub document. If `save_document` isn't available on the active transport, the app tags the seed entity instead. Every write returns `403` unless `DATAHUB_ALLOW_MUTATIONS=true`.

The browser never talks to DataHub directly. All DataHub calls go through the server routes, so `DATAHUB_TOKEN` stays on the server.

### Transports

`lib/datahub/transport.js` has two implementations behind one tool-style interface:

- **MCP:** JSON-RPC over streamable HTTP to a DataHub MCP server. Used when `DATAHUB_MCP_URL` is set.
- **GraphQL:** calls DataHub GMS's `/api/graphql` directly (queries are in `lib/datahub/queries.js`). Used when only `DATAHUB_GMS_URL` is set, for example with a local quickstart where MCP runs over stdio.

## Stack

- Next.js 15.5 (App Router), React 19, plain JavaScript
- `@excalidraw/excalidraw` ^0.18.1 for the canvas
- Anthropic Messages API, called with `fetch` (no SDK)
- DataHub, via an MCP server or GMS GraphQL

## Running locally

Requirements: Node.js and npm. The repo has no `engines` field and no lockfile; it was verified with Node 22.

```bash
npm install
npm run dev        # http://localhost:3000
# or
npm run build && npm start
```

The built-in examples work without any environment variables. Everything else needs the following:

| Variable | Used by | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `/api/generate`, `/api/datahub/annotate` | Prompt mode returns `500` without it. |
| `MODEL` | `/api/generate` | Optional. Defaults to `claude-haiku-4-5-20251001`. (The annotate route sets its model in code.) |
| `DAILY_LIMIT` | `/api/generate` | Optional. Defaults to `10` prompt generations per IP per day. The counter is in memory and per instance. |
| `DATAHUB_TOKEN` | all DataHub routes | Required. The DataHub routes return an error when it's missing. |
| `DATAHUB_MCP_URL` | DataHub routes | Optional. If set, the MCP transport is used. |
| `DATAHUB_GMS_URL` | DataHub routes | GraphQL fallback, e.g. `http://localhost:8080`. You need this or `DATAHUB_MCP_URL`. |
| `DATAHUB_ALLOW_MUTATIONS` | `/api/datahub/writeback` | Write-back is enabled only when this is exactly `true`. |

There is no `.env.example`. Put these in `.env.local` and don't commit it.

DataHub mode needs a DataHub instance to point at. The [DataHub docs](https://docs.datahub.com) cover the quickstart.

## API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/generate` | POST | `{ content, maxColors, style, handles }` or `{ example }`. Returns the `.excalidraw` JSON as an attachment. |
| `/api/datahub/search` | GET | Entity search for the picker. |
| `/api/datahub/graph` | POST | `{ seed, mode?, direction?, hops?, maxNodes?, filters?, refine? }`. Returns the pruned intermediate graph. |
| `/api/datahub/annotate` | POST | Claude refinement and suggestions, validated against the graph. |
| `/api/datahub/writeback` | POST | `tag`, `describe` or `document`; gated by `DATAHUB_ALLOW_MUTATIONS`. |

## Repo layout

```
app/
  page.js                 # prompt / DataHub mode switch, preview, download
  layout.js, globals.css
  components/
    DataHubPanel.js       # entity picker, view modes, trace rail, suggestions
    Preview.js            # Excalidraw canvas
  api/
    generate/             # prompt -> spec -> .excalidraw
    datahub/{search,graph,annotate,writeback}/
lib/
  spec.js                 # prompt builder + spec parsing/validation
  excalidraw.js           # spec -> Excalidraw file, plus file validation
  layout.js               # flow / hub layout for prompt mode
  avatars.js              # unavatar.io -> embedded data URLs
  examples.js             # canned example specs
  datahub/
    client.js             # browser-side helpers and view modes
    transport.js          # MCP + GraphQL transports
    queries.js            # GraphQL operations
    orchestrator.js       # multi-step DataHub calls -> intermediate graph
    prune.js              # scoring, staging clusters, critical paths
    layout.js             # tiered layout for lineage
    excalidraw.js         # intermediate graph -> Excalidraw scene
```

There is no test suite in the repo.

## Credits

- [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT) for the canvas and file format.
- [DataHub](https://docs.datahub.com) for the metadata platform and its MCP and GraphQL APIs.
- [unavatar.io](https://unavatar.io) for avatar lookup.

## License

[Apache-2.0](LICENSE) © 2026 Levi (@levithefirst). Third-party packages keep their own licenses.
