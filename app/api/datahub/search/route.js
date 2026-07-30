/**
 * GET /api/datahub/search?q=revenue&types=DATASET,DASHBOARD
 *
 * powers the entity picker. replacing sketchdrop's blank prompt box with an
 * entity picker is the single most important ux change: it makes datahub the
 * source of truth instead of a thing you describe in prose.
 */

import { makeTransport } from '../../../lib/datahub/transport';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();

  if (!q) {
    return Response.json({ error: 'q is required' }, { status: 400 });
  }

  const types = (searchParams.get('types') ?? 'DATASET,DASHBOARD,DATA_JOB,MLMODEL')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const transport = await makeTransport();
    const raw = await transport.callTool('search', { query: q, count: 12, types });

    const results = (raw?.searchResults ?? []).map((r) => {
      const e = r.entity ?? {};
      return {
        urn: e.urn,
        type: e.type,
        name: e.properties?.name ?? e.name ?? e.urn,
        qualifiedName: e.properties?.qualifiedName,
        platform:
          e.platform?.properties?.displayName ?? e.platform?.name?.split(':').pop() ?? null,
        domain: e.domain?.domain?.properties?.name ?? null,
        description: e.properties?.description ?? null,
        ownerCount: (e.ownership?.owners ?? []).length,
      };
    });

    return Response.json({ total: raw?.total ?? results.length, results, trace: transport.trace });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'search failed' },
      { status: 502 },
    );
  }
}
