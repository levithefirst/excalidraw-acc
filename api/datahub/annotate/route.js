/**
 * POST /api/datahub/annotate
 *
 * the only place an llm touches this pipeline, and it is deliberately fenced in.
 *
 * claude is not allowed to:
 *   - invent nodes or edges
 *   - place anything on the canvas
 *   - emit excalidraw json
 *
 * claude is asked to do two things it is actually good at:
 *   1. turn a natural-language refinement into a keep/drop decision over urns
 *      that already exist in the graph
 *   2. propose descriptions and tags for the metadata gaps the orchestrator found,
 *      which the user can approve and write back
 *
 * every returned urn is validated against the graph before it reaches the client.
 * a hallucinated urn is dropped, not rendered.
 */

const SYSTEM = `you are a metadata analyst working over a validated datahub lineage graph.

you will receive a json graph of data assets and a user refinement instruction.

rules:
- never invent urns. only ever reference urns present in the input.
- never output coordinates, shapes, or excalidraw json.
- descriptions must be grounded in the asset name, platform, column names, and
  lineage position. if you cannot ground a description, omit it.
- tags must come from this vocabulary only: PII, Sensitive, Deprecated, Certified,
  Staging, Critical, Undocumented.

respond with json only, no markdown fences, matching:
{
  "keep": ["urn", ...],
  "drop": ["urn", ...],
  "dropReason": "one sentence",
  "suggestions": [
    { "urn": "...", "field": "optional column path", "kind": "description" | "tag",
      "value": "...", "rationale": "..." }
  ]
}

if the refinement instruction is empty, return every urn in "keep" and an empty
"drop", and focus entirely on suggestions for assets with metadata gaps.`;

export async function POST(req) {
  const body = await req.json().catch(() => null);
  const graph = body?.graph;

  if (!graph?.nodes?.length) {
    return Response.json({ error: 'graph with nodes is required' }, { status: 400 });
  }

  // hand the model a compact view. the full graph would waste most of the budget
  // on schema fields the model does not need to reason about.
  const compact = {
    mode: graph.mode,
    seedUrn: graph.seedUrn,
    nodes: graph.nodes.map((n) => ({
      urn: n.urn,
      label: n.label,
      kind: n.kind,
      platform: n.platform,
      domain: n.domain ?? null,
      hop: n.hop,
      deprecated: n.deprecated,
      quality: n.quality.status,
      hasDescription: Boolean(n.description),
      owners: n.owners.map((o) => o.name),
      gaps: n.gaps,
      columns: n.fields.slice(0, 10).map((f) => ({
        path: f.path,
        type: f.type,
        documented: Boolean(f.description),
        pii: f.isPii,
      })),
    })),
    edges: graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
  };

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `refinement instruction: ${body.refine?.trim() || '(none)'}\n\ngraph:\n${JSON.stringify(compact)}`,
          },
        ],
      }),
    });

    if (!apiRes.ok) throw new Error(`anthropic ${apiRes.status}: ${await apiRes.text()}`);

    const data = await apiRes.json();
    const raw = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .replace(/```json|```/g, '')
      .trim();

    const parsed = JSON.parse(raw);

    // validation gate. anything the model made up dies here.
    const valid = new Set(graph.nodes.map((n) => n.urn));
    const fieldsByUrn = new Map(graph.nodes.map((n) => [n.urn, new Set(n.fields.map((f) => f.path))]));

    const keep = (parsed.keep ?? []).filter((u) => valid.has(u));
    const drop = (parsed.drop ?? []).filter((u) => valid.has(u));

    const suggestions = (parsed.suggestions ?? []).filter((s) => {
      if (!valid.has(s.urn)) return false;
      if (s.field && !fieldsByUrn.get(s.urn)?.has(s.field)) return false;
      if (s.kind === 'tag') {
        return ['PII', 'Sensitive', 'Deprecated', 'Certified', 'Staging', 'Critical', 'Undocumented'].includes(
          s.value,
        );
      }
      return typeof s.value === 'string' && s.value.length > 10;
    });

    const rejected =
      (parsed.keep?.length ?? 0) + (parsed.drop?.length ?? 0) + (parsed.suggestions?.length ?? 0) -
      (keep.length + drop.length + suggestions.length);

    return Response.json({
      // seed always survives a refinement. dropping the thing you asked about is
      // never what anyone meant.
      keep: keep.length ? [...new Set([graph.seedUrn, ...keep])] : graph.nodes.map((n) => n.urn),
      drop: drop.filter((u) => u !== graph.seedUrn),
      dropReason: typeof parsed.dropReason === 'string' ? parsed.dropReason : '',
      suggestions,
      validation: { rejectedForHallucination: Math.max(0, rejected) },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'annotation failed' },
      { status: 502 },
    );
  }
}
