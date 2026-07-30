/**
 * POST /api/datahub/graph
 *
 * body: { seed, mode?, direction?, hops?, maxNodes?, filters?, refine? }
 * returns: the intermediate graph
 *
 * this is the only datahub call the browser makes. the token never leaves the
 * server, and the browser never sees a raw metadata payload.
 */

import { makeTransport } from '../../../../lib/datahub/transport';
import { DataHubOrchestrator } from '../../../../lib/datahub/orchestrator';

export const maxDuration = 60;

export async function POST(req) {
  const body = await req.json().catch(() => null);

  if (!body?.seed || typeof body.seed !== 'string') {
    return Response.json(
      { error: 'seed is required: a datahub urn or an entity name' },
      { status: 400 },
    );
  }

  try {
    const transport = await makeTransport();
    const orchestrator = new DataHubOrchestrator(transport);
    const graph = await orchestrator.build(body);

    return Response.json(graph, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
  } catch (err) {
    // return the trace even on failure. a half-built trace is the most useful
    // thing you can hand someone debugging a datahub connection.
    return Response.json(
      { error: err instanceof Error ? err.message : 'graph build failed' },
      { status: 502 },
    );
  }
}
