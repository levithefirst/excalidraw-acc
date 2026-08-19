# Subsketch — ETHOnline 2026 Continuity Package

Continuity submission built on top of **sketchdrop for DataHub** (Build with DataHub: The Agent Hackathon, Open/Wildcard track). Same engine — search → traverse → prune → deterministic layout → live Excalidraw canvas → optional write-back — repointed at on-chain and subgraph data instead of DataHub.

---

## A. Name, tagline, pitch

**Name:** Subsketch
**Tagline:** Living diagrams of on-chain truth, powered by The Graph.

**Elevator pitch (3 sentences):** Ethereum's lineage — who deployed what, which subgraphs index which contracts, how protocols compose — still lives in static explorers and screenshots nobody can edit. Subsketch takes a contract address, ENS name, or subgraph endpoint, pulls real topology from The Graph's indexed data, and turns it into a beautiful, editable Excalidraw diagram in seconds, with an agent that prunes noise, flags risk signals, and proposes missing edges. It's the same agentic-prune → deterministic-layout → live-canvas pipeline that already works for DataHub lineage, now grounded in on-chain truth instead of a data catalog.

---

## B. Architecture: what stays, what's replaced, what's new

**Stays untouched (the DNA):**
- `lib/datahub/prune.js` → generalized into `lib/graph/prune.js` — hop distance, terminal-node bias, "never prune failing/flagged nodes" rule. Scoring inputs change, the algorithm doesn't.
- `lib/datahub/layout.js` → generalized into `lib/graph/layout.js` — deterministic tiered layout. Never touched by an LLM. This is the thing judges will ask about and it's already built.
- `lib/datahub/excalidraw.js` → `lib/graph/excalidraw.js` — intermediate graph → Excalidraw scene mapper. Shape/color encoding rules change (see below), structure doesn't.
- `app/components/Preview.js` — the Excalidraw canvas itself. Untouched.
- The hallucination-guard pattern in the annotate route (validate every Claude-suggested URN/address against the real fetched graph before rendering it) — reused verbatim for contract addresses.

**Replaced:**
- `lib/datahub/transport.js` (MCP/GraphQL to a DataHub GMS) → `lib/graph/transport.js`: a client for **The Graph's GraphQL endpoints** (The Graph Network gateway + a curated set of public subgraphs — Uniswap v3, ENS, Lens, plus any subgraph endpoint URL the user pastes) and an on-chain fallback via a public RPC/Etherscan-style API for contracts with no subgraph.
- `lib/datahub/orchestrator.js` → `lib/graph/orchestrator.js`: same `build()` call-chaining shape (resolve seed → fetch topology → batch-enrich survivors → second prune pass), but the calls are `resolveEnsOrAddress`, `fetchSubgraphTopology` (factory/pool/pair relationships, token flows, deployer→contract edges), `enrichContracts` (verification status, proxy/implementation links, ownership/admin keys), `fetchOnchainSignals` (gas usage, tx volume, holder count, last-activity recency).
- `app/api/datahub/*` routes → `app/api/graph/*` (`search`, `graph`, `annotate`, `writeback`).
- DataHub write-back (tags/descriptions to GMS) → **on-chain-adjacent write-back**: save the finalized diagram + its data snapshot to **IPFS** (via web3.storage-style pinning) and optionally register the CID against the entity in a tiny Neon-backed public registry with a shareable, always-current link (`subsketch.app/g/<slug>` → resolves latest pinned version).

**New modules (all thin, all Continuity-appropriate — extensions, not rewrites):**
- `lib/graph/subgraphRegistry.js` — curated list of high-quality public subgraph endpoints (Uniswap, Aave, ENS, Lens, Compound) + a "paste your own endpoint" path, so the demo never depends on one indexer being up.
- `lib/graph/signals.js` — pulls gas/verification/volume signals (Etherscan-compatible API, RPC `eth_getCode`) and folds them into the prune scorer as risk/importance weights: unverified contract = flagged, not pruned; high tx volume = kept even at deeper hops; proxy without a timelock = surfaced as a risk badge.
- `app/db/schema.sql` + `lib/db/neon.js` — Neon Postgres for saved diagrams, share links, and diagram history (append-only snapshots per entity so a shared link can show "diagram as of block N").
- `app/api/share/[slug]/route.js` — public, no-auth read endpoint for shared diagrams (the thing a judge clicks from your README).
- `app/components/OnboardingHint.js`, `app/components/EmptyState.js`, `app/components/Skeletons.js` — shadcn/ui polish layer (see section C/6).
- `app/api/graph/ask/route.js` — "ask the graph" — Claude answers questions about the currently-rendered diagram using only the fetched node/edge data as context (same hallucination-guard pattern, read-only, no new fetches).

**What we deliberately do NOT build:** no smart contract, no wallet-custodied writes, no mainnet transactions. Every "on-chain" claim is either read (subgraph/RPC queries) or off-chain-but-verifiable (IPFS content hashes). This keeps it buildable solo, browser-only, and avoids audit risk entirely — and it's honest: judges can verify every number on the diagram against Etherscan themselves.

---

## C. Feature list

**Must-have (the demo doesn't work without these):**
1. Address/ENS/subgraph-endpoint input → resolved seed entity
2. Subgraph topology fetch with graceful fallback to raw RPC when no subgraph exists
3. Agentic prune with on-chain signal weighting (gas, volume, verification)
4. Deterministic layout, unchanged algorithm from sketchdrop
5. Live editable Excalidraw canvas
6. Hallucination-guarded Claude refinement pass ("what's missing / what looks risky")
7. Export: PNG, `.excalidraw`, shareable link
8. Deployed, working demo URL on Vercel

**High-impact (what pushes this from "nice tool" to "obviously the winner"):**
9. Risk badges on nodes: unverified source, proxy-without-timelock, no recent activity, high concentration of holders — pulled from real signals, not vibes
10. "Ask the graph" — chat panel that answers questions about the rendered diagram grounded in the actual fetched data
11. Save-to-IPFS + Neon-backed permanent share link that judges can open cold, no login
12. Diagram history / "as of block N" — shows this isn't a static screenshot, it's regenerable
13. Curated subgraph picker (Uniswap, ENS, Aave, Lens) as one-click demo starters — removes all "type an address" friction for judges

**Nice-to-have (do these only if the must-haves are rock solid with 2+ days left):**
14. Multi-entity comparison (two protocols side by side)
15. Keyboard shortcuts + copy-as-image
16. Wallet connect (RainbowKit) purely to auto-fill "diagrams involving my wallet" — not required for core flow, don't gate anything behind it
17. Dark mode toggle beyond system default

---

## D. 7–10 day solo build plan (with Claude)

**Day 1 — Transport layer.** Write `lib/graph/transport.js` against 2–3 known-good public subgraph endpoints (Uniswap v3 mainnet, ENS). Prove you can pull factory→pool→token topology as JSON. This is the highest-risk piece (external endpoint reliability) — de-risk it first.

**Day 2 — Orchestrator port.** Copy `orchestrator.js`'s call-chaining structure, swap DataHub tool calls for subgraph queries + RPC fallback. Reuse `prune.js` and `layout.js` unmodified against the new node shape (map subgraph entities into the same intermediate node interface DataHub used — this is why the interface being generic already pays off).

**Day 3 — Rendering + signals.** `lib/graph/excalidraw.js` shape/color encoding for contract kinds (pool, token, proxy, EOA deployer, factory) and risk badges. `lib/graph/signals.js` for gas/verification/volume via a free-tier Etherscan-style API.

**Day 4 — UI pass 1.** Swap `DataHubPanel.js` for a `GraphPanel.js`: address/ENS input, curated-subgraph quick-picks, mode toggle (protocol map / impact / ownership). Get the full pipe working end to end, ugly is fine.

**Day 5 — Claude refinement + hallucination guard + "ask the graph".** Port the annotate route's URN-validation pattern to address-validation. Add the read-only Q&A endpoint.

**Day 6 — Neon + share links + IPFS.** Schema, save endpoint, `/g/[slug]` public read route, pin-to-IPFS on save.

**Day 7 — shadcn/ui redesign.** Full pass: dark mode, empty states, skeletons, onboarding hint, mobile breakpoints. This is where "hackathon project" becomes "product."

**Day 8 — Deploy + polish loop.** Vercel deploy, fix env/CORS/timeout issues against real subgraph latency, add loading states for slow indexers.

**Day 9 — README, video script, pitch scripts, screenshots.** Everything in sections E–H below, tailored with real screenshots once the redesign is live.

**Day 10 — Buffer.** Judges' demo-day nightmare is always the one dependency that goes down mid-demo. Use this day to add a cached/offline fallback dataset for your 2–3 hero demo entities so the live demo never depends on a subgraph indexer's uptime.

---

## E. README.md (ready to paste as the new root README)

```markdown
# Subsketch

Living diagrams of on-chain truth, powered by The Graph.

Continuity submission for ETHOnline 2026, built on **sketchdrop for DataHub**
(Build with DataHub: The Agent Hackathon). Same engine, new source of truth:
instead of a data catalog, Subsketch pulls real topology from The Graph's
indexed subgraphs and on-chain data, and renders it as a live, editable
Excalidraw canvas.

**Live demo:** https://subsketch.vercel.app
**60-second video:** <link>

## What it does

Protocol maps and lineage on Ethereum are still static screenshots or
unreadable explorer trees. Subsketch turns a contract, ENS name, or subgraph
endpoint into a diagram you can actually edit, annotate, export, and drop
into a PR, an audit doc, or a governance post — without losing the real data
underneath it.

1. **Search** — paste an address, ENS name, or subgraph endpoint, or pick a
   curated protocol (Uniswap, Aave, ENS, Lens).
2. **Traverse** — pulls factory/pool/token topology and deployer→contract
   relationships from The Graph, with an RPC fallback for anything with no
   subgraph.
3. **Prune** — an agentic scoring pass collapses hundreds of raw nodes down
   to what matters, weighted by real on-chain signals: gas usage, tx volume,
   verification status, holder concentration. Unverified contracts and
   proxies without a timelock are never pruned — they're flagged instead.
4. **Render** — deterministic tiered layout (no LLM ever places a node),
   rendered as a real Excalidraw scene: hop distance drives position,
   contract kind drives shape, risk signal drives stroke color.
5. **Refine** — Claude proposes missing edges, risky patterns, or better
   labels. Every suggestion is validated against the real fetched graph;
   anything hallucinated is dropped and the count is shown in the UI.
6. **Ask** — a read-only chat panel answers questions about the diagram
   currently on screen, grounded only in the data that's already been
   fetched.
7. **Share** — save pins the diagram to IPFS and a Neon-backed link stays
   permanently viewable, no login required.

## Continuity: what came from sketchdrop, what's new

Subsketch is a direct evolution of `sketchdrop for DataHub`, not a rewrite.
Kept unchanged: the deterministic layout engine, the agentic prune scorer,
the Excalidraw scene mapper, and the hallucination-guard pattern for
LLM-suggested edits. Replaced: the transport layer (DataHub MCP/GraphQL →
The Graph GraphQL + RPC fallback) and the enrichment signals (schema/quality
assertions → verification/gas/volume). New: on-chain risk badges, IPFS +
Neon share links, and the "ask the graph" panel.

## Stack

- Next.js 15 (App Router), JavaScript
- Excalidraw for rendering
- The Graph (subgraph GraphQL endpoints) + RPC fallback for topology
- Neon Postgres for saved diagrams and share links
- Anthropic API (Claude) for refinement/Q&A only — never layout
- Deployed on Vercel

## Setup

\`\`\`
ANTHROPIC_API_KEY=
DATABASE_URL=              # Neon connection string
THEGRAPH_API_KEY=          # optional, for gateway-routed subgraphs
ETHERSCAN_API_KEY=         # for verification/gas signals
IPFS_PINNING_TOKEN=        # web3.storage or similar
\`\`\`

\`npm install && npm run dev\`

## Repo layout

\`\`\`
app/
  api/
    graph/       search | graph | annotate | ask | writeback
    share/[slug] public read endpoint for saved diagrams
  components/    GraphPanel, Preview, EmptyState, Skeletons, OnboardingHint
lib/
  graph/         transport | orchestrator | prune | layout | excalidraw | signals | subgraphRegistry
  db/            neon.js
\`\`\`

## What's next

- Multi-chain (Base, Arbitrum subgraphs)
- Governance-proposal diffing (before/after a DAO vote)
- Team/collab editing on a shared canvas
- On-chain attestation of a diagram's data snapshot (EAS)

## License

MIT
\`\`\`
```

---

## F. 90-second demo script

- **0:00–0:10** — "Data lineage and protocol maps on Ethereum are still static screenshots. Subsketch makes them living and editable." Open the app: clean landing, dark mode, one input box.
- **0:10–0:25** — Click a curated quick-pick: "Uniswap v3 — USDC/ETH pool." Loading skeleton shows real steps ("fetching subgraph topology…", "pruning…", "laying out…") — not a spinner.
- **0:25–0:45** — Diagram renders on the Excalidraw canvas: factory → pool → tokens, with a risk badge on one flagged node. Drag a node to show it's genuinely editable, not an image.
- **0:45–1:00** — Open the Claude panel: "what's missing here?" — Claude proposes an edge or flags an unverified helper contract; show the hallucinated-suggestion counter proving the guard is real.
- **1:00–1:15** — Ask the graph: "which token has more liquidity concentration risk?" — grounded answer appears, cite it comes from the data on screen.
- **1:15–1:30** — Click Save → shareable link appears, pinned to IPFS. Paste the link in a new tab to prove it loads with no login. End on tagline: "Living diagrams of on-chain truth, powered by The Graph."

---

## G. Pitch scripts

**1-minute:**
"Ethereum's protocol maps live in static explorers you can't edit or share cleanly. Subsketch turns a contract, ENS name, or subgraph into a real diagram — pulled live from The Graph, pruned by an agent that knows which nodes matter, laid out deterministically so it's never LLM-guessed geometry, and rendered on an editable Excalidraw canvas you can drag, annotate, and export. It flags real risk signals — unverified contracts, proxies without timelocks — instead of hiding them. This isn't new from scratch: it's the continuation of sketchdrop, a DataHub lineage tool we built for a data-catalog hackathon, now repointed at on-chain truth. Same pipeline, same guardrails against hallucination, new source of ground truth. It's live, it's on Vercel, and the diagram you see is one your team can actually keep."

**3-minute:**
Add: (1) the Continuity story — walk through what code is untouched (prune, layout, Excalidraw mapper) versus swapped (transport layer, enrichment signals) and why that split matters — the hard, novel part of the original project (deterministic layout that never hallucinates coordinates, an agentic prune that respects hard constraints) ports cleanly because it was built generic; (2) a live walk through the risk-badge and "ask the graph" features with a real flagged contract; (3) the sponsor-fit note — The Graph is the primary data source, not a bolt-on, because subgraph topology is genuinely the right shape of data for this problem; (4) the roadmap — multi-chain, governance-proposal diffing, EAS attestation of diagram snapshots — showing this is a platform, not a hackathon toy.

---

## H. Concrete code changes / new files / env vars

**New files:**
- `lib/graph/transport.js`, `lib/graph/orchestrator.js`, `lib/graph/signals.js`, `lib/graph/subgraphRegistry.js`
- `lib/graph/prune.js`, `lib/graph/layout.js`, `lib/graph/excalidraw.js` (ported/generalized from `lib/datahub/*`)
- `lib/db/neon.js`, `app/db/schema.sql`
- `app/api/graph/search/route.js`, `app/api/graph/graph/route.js`, `app/api/graph/annotate/route.js`, `app/api/graph/ask/route.js`, `app/api/graph/writeback/route.js`
- `app/api/share/[slug]/route.js`
- `app/components/GraphPanel.js`, `app/components/EmptyState.js`, `app/components/Skeletons.js`, `app/components/OnboardingHint.js`, `app/components/RiskBadge.js`

**Modified:**
- `app/page.js` — mount `GraphPanel` alongside/instead of `DataHubPanel`
- `package.json` — add `pg` (Neon), a subgraph/GraphQL client if not doing raw `fetch`, and (optional) an IPFS pinning SDK
- `README.md` — replaced per section E

**New env vars:**
```
DATABASE_URL=
THEGRAPH_API_KEY=
ETHERSCAN_API_KEY=
IPFS_PINNING_TOKEN=
```

---

## I. Judging scorecard (target 9–10/10)

| Axis | Why it scores high |
|---|---|
| Novelty | "Living, editable diagram grounded in live indexed data" is not another block explorer or dashboard — nobody else is shipping an Excalidraw-native protocol map with a deterministic layout guarantee. |
| Technical difficulty | Deterministic layout engine (no LLM coordinates), agentic prune with hard-constraint exceptions, hallucination-guarded LLM suggestions validated against live-fetched data, multi-source topology (subgraph + RPC fallback). |
| Design/UX | Full shadcn/ui pass, dark mode, real loading states that show pipeline steps, empty states, mobile-responsive, 20-second onboarding. |
| Usefulness | Solves a real, felt pain (static, unshareable protocol maps) for devs, auditors, and governance participants — not a toy use case. |
| Completeness | Live Vercel demo, README with screenshots + video script, pitch scripts at two lengths, working share links, roadmap. |
| Sponsor fit (The Graph) | Subgraph GraphQL is the primary data source, not decoration — the whole pipeline is built around "what topology can we actually pull from an indexer," with curated demo subgraphs and graceful fallback. |
| Storytelling | Clear before/after (static screenshot → living diagram), explicit Continuity narrative showing what carried over and why, concrete 90-second demo that proves every claim on screen. |

---

## J. Final 48-hour checklist

- [ ] 2–3 hero demo entities have a cached/offline fallback in case the live subgraph endpoint is slow or down during judging
- [ ] Deployed Vercel URL loads cold (no dev server dependency) and the share-link flow works in an incognito tab
- [ ] README has real screenshots (not placeholders) and the video script matches the actual current UI
- [ ] Hallucination-guard counter is visibly demoed at least once (judges reward guardrails they can see working)
- [ ] Every "on-chain" claim in the pitch is independently checkable against Etherscan/thegraph.com — no unverifiable claims
- [ ] Continuity section explicitly names the original hackathon/project and lists what's reused vs. new
- [ ] 1-minute and 3-minute pitch scripts rehearsed against a timer
- [ ] Mobile viewport spot-checked (judges often open the link on a phone)
- [ ] Remove/guard any write-path (writeback, save) behind clear confirmation — no silent on-chain-adjacent writes
- [ ] `npm run build` passes clean on a fresh clone with only the documented env vars set
