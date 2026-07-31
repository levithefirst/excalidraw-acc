# sketchdrop for DataHub

AI-powered diagram generator. Pick a DataHub entity, sketchdrop pulls its lineage, schema, ownership, and quality metadata and renders it as a live, editable Excalidraw canvas — with write-back to DataHub for approved suggestions.

Built for **Build with DataHub: The Agent Hackathon** — Open / Wildcard track.

Live app: [excalidraw-acc.vercel.app](https://excalidraw-acc.vercel.app)

## What it does

sketchdrop already turns a text prompt into an editable Excalidraw diagram. This adds a second mode: instead of a prompt, you search for a real DataHub entity, and the app builds the diagram from real lineage data instead of an LLM guessing at a picture.

DataHub's native lineage explorer is static and read-only. This turns the same graph into something you can edit, export, and drop into a PR or RFC, with the option to write suggested tags and descriptions back to DataHub.

## How it works

1. **Search** — find a DataHub entity (dataset, dashboard, chart, ML model) by name.
2. **Traverse** — the app pulls upstream/downstream lineage, schema fields, assertions, and query traffic via DataHub's MCP Server (or GraphQL as a fallback).
3. **Prune** — an agentic scoring pass collapses hundreds of raw nodes down to what matters: hop distance, terminal-consumer status, governance signals, and quality flags. Nodes with failing assertions, deprecation flags, or PII are never pruned.
4. **Render** — the pruned graph is laid out deterministically (no LLM-generated coordinates) and rendered as a real Excalidraw scene: hop distance drives horizontal position, domain drives vertical banding, entity kind drives shape, quality status drives stroke color.
5. **Refine** — an optional natural-language refinement step lets Claude propose which nodes to keep/drop and suggest missing descriptions or tags. Every suggested URN is validated against the real graph; anything hallucinated is dropped and the count is shown in the UI.
6. **Write back** *(optional, off by default)* — approved tags/descriptions get pushed back to DataHub.

## Stack

- Next.js 15 (App Router), plain JavaScript
- Deployed on Railway
- Excalidraw for rendering
- Anthropic API (Claude) for the refinement/annotation step only — it never generates layout or coordinates
- DataHub OSS, self-hosted quickstart, accessed via MCP Server / GraphQL

## Setup

1. Clone the repo and run `npm install`.
2. Set the following environment variables:

```
ANTHROPIC_API_KEY=          # for the prompt-to-diagram and annotate features
DATAHUB_GMS_URL=            # your DataHub GMS URL, e.g. http://localhost:8080
DATAHUB_MCP_URL=            # optional, if your DataHub instance exposes /mcp
DATAHUB_TOKEN=              # DataHub personal access token (quickstart default has no auth enforced)
DATAHUB_ALLOW_MUTATIONS=    # "true" to enable write-back, defaults to "false"
```

3. `npm run dev` to run locally, or deploy to Railway/Vercel with the same variables set.
4. You'll need a running DataHub instance to point at. The official OSS quickstart works: see [datahub docs](https://docs.datahub.com) for `docker compose` setup instructions.

## Repo layout

```
app/
  api/
    generate/            # original prompt-to-diagram endpoint
    datahub/
      graph/              # builds the intermediate graph from a seed entity
      search/             # entity search/picker
      annotate/           # Claude refinement + hallucination-checked suggestions
      writeback/          # tags/descriptions back to DataHub, gated
  components/
    DataHubPanel.js        # entity picker, mode toggle, trace rail
    Preview.js              # Excalidraw canvas renderer
  lib/
    datahub/
      transport.js          # MCP + GraphQL client implementations
      prune.js                # scoring, clustering, critical-path marking
      orchestrator.js          # chains the multi-step DataHub calls
      layout.js                 # deterministic tiered layout engine
      excalidraw.js              # intermediate graph → Excalidraw scene mapper
```

## Why it matters

Data teams live in DataHub's UI to answer "what feeds this dashboard" or "what breaks if I change this table." That answer is currently a static graph you can't edit or share cleanly. sketchdrop turns it into something usable in a doc, a slide, or a PR description, without losing the real metadata behind it.
