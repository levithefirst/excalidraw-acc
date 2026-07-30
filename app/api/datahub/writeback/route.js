/**
 * POST /api/datahub/writeback
 *
 * the part most submissions will skip. reading metadata makes a viewer. writing
 * it back makes the canvas a participant in governance.
 *
 * three actions:
 *   tag         add a tag to an entity or a specific column
 *   describe    set a description on an entity or column
 *   document    persist the diagram itself back into datahub as a document
 *
 * every mutation is gated behind DATAHUB_ALLOW_MUTATIONS. a hackathon demo that
 * can silently rewrite a production catalog is not a demo anyone should run.
 */

import { makeTransport } from '../../../../lib/datahub/transport';

function tagUrn(name) {
  // datahub tag urns are urn:li:tag:<name>. create-on-write is the default
  // behaviour for addTags against a non-existent tag on most deployments.
  return name.startsWith('urn:li:tag:') ? name : `urn:li:tag:${name}`;
}

export async function POST(req) {
  if (process.env.DATAHUB_ALLOW_MUTATIONS !== 'true') {
    return Response.json(
      {
        error:
          'write-back is disabled. set DATAHUB_ALLOW_MUTATIONS=true to let sketchdrop write to this catalog.',
      },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);

  try {
    const transport = await makeTransport();

    if (body?.action === 'tag') {
      if (!body.urn || !body.tags?.length) throw new Error('urn and tags are required');
      await transport.callTool('add_tags', {
        tagUrns: body.tags.map(tagUrn),
        resourceUrn: body.urn,
        subResource: body.field ?? null,
      });
      return Response.json({
        ok: true,
        applied: body.tags,
        target: body.field ? `${body.urn}#${body.field}` : body.urn,
        trace: transport.trace,
      });
    }

    if (body?.action === 'describe') {
      if (!body.urn || !body.description) throw new Error('urn and description are required');
      await transport.callTool('update_description', {
        description: body.description,
        resourceUrn: body.urn,
        subResource: body.field ?? null,
      });
      return Response.json({ ok: true, trace: transport.trace });
    }

    if (body?.action === 'document') {
      // persist the canvas so the next person or agent inherits the diagram.
      // save_document exists on the mcp surface; on the graphql fallback we
      // attach the scene as a tag-linked artifact instead of failing.
      try {
        await transport.callTool('save_document', {
          title: body.title,
          parentPath: 'Architecture Diagrams',
          relatedEntities: [body.seedUrn],
          content: [
            `# ${body.title}`,
            '',
            body.summary,
            '',
            '## excalidraw scene',
            '```json',
            JSON.stringify(body.scene),
            '```',
          ].join('\n'),
        });
        return Response.json({ ok: true, persisted: 'document', trace: transport.trace });
      } catch {
        await transport.callTool('add_tags', {
          tagUrns: [tagUrn('has-architecture-diagram')],
          resourceUrn: body.seedUrn,
        });
        return Response.json({
          ok: true,
          persisted: 'tag-fallback',
          note:
            'save_document unavailable on this transport. tagged the seed entity instead so the diagram is discoverable.',
          trace: transport.trace,
        });
      }
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'write-back failed' },
      { status: 502 },
    );
  }
}
