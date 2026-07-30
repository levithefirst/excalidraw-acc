/**
 * frontend client for the datahub endpoints.
 * no datahub credentials exist in this file or anywhere else in the bundle.
 */
import { toExcalidraw } from './excalidraw';
async function post(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok)
        throw new Error(json.error ?? `${path} failed`);
    return json;
}
export async function searchEntities(q) {
    const res = await fetch(`/api/datahub/search?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    if (!res.ok)
        throw new Error(json.error ?? 'search failed');
    return json.results ?? [];
}
export function buildGraph(req) {
    return post('/api/datahub/graph', req);
}
export function annotate(graph, refine) {
    return post('/api/datahub/annotate', { graph, refine });
}
export function applyTag(urn, tags, field) {
    return post('/api/datahub/writeback', { action: 'tag', urn, tags, field });
}
export function applyDescription(urn, description, field) {
    return post('/api/datahub/writeback', {
        action: 'describe',
        urn,
        description,
        field,
    });
}
export function saveDiagram(graph, scene, title) {
    return post('/api/datahub/writeback', {
        action: 'document',
        seedUrn: graph.seedUrn,
        title,
        scene,
        summary: summarize(graph),
    });
}
/** apply an annotation result to the graph, then render. */
export function render(graph, keep) {
    if (!keep?.length)
        return toExcalidraw(graph);
    const set = new Set(keep);
    const nodes = graph.nodes.filter((n) => set.has(n.urn));
    const edges = graph.edges.filter((e) => set.has(e.from) && set.has(e.to));
    return toExcalidraw({
        ...graph,
        nodes,
        edges,
        stats: { ...graph.stats, nodesRendered: nodes.length, edgesRendered: edges.length },
    });
}
export function summarize(graph) {
    const failing = graph.nodes.filter((n) => n.quality.status === 'failing');
    const deprecated = graph.nodes.filter((n) => n.deprecated);
    const unowned = graph.nodes.filter((n) => n.gaps.includes('no_owner'));
    const pii = graph.nodes.filter((n) => n.fields.some((f) => f.isPii));
    const lines = [
        `${graph.mode} view generated from datahub lineage, ${graph.stats.hopsTraversed} hop limit.`,
        `${graph.stats.nodesRendered} of ${graph.stats.nodesDiscovered} discovered entities rendered; ${graph.stats.prunedForNoise} pruned as low-signal.`,
    ];
    if (failing.length)
        lines.push(`failing assertions: ${failing.map((n) => n.label).join(', ')}.`);
    if (deprecated.length)
        lines.push(`deprecated assets on this path: ${deprecated.map((n) => n.label).join(', ')}.`);
    if (pii.length)
        lines.push(`pii-tagged columns present in: ${pii.map((n) => n.label).join(', ')}.`);
    if (unowned.length)
        lines.push(`unowned assets needing a steward: ${unowned.map((n) => n.label).join(', ')}.`);
    return lines.join('\n');
}
/* ---------------- mode presets ---------------- */
export const MODES = {
    architecture: {
        label: 'Architecture',
        blurb: 'Upstream and downstream, grouped by domain. For onboarding and design reviews.',
        defaults: { direction: 'BOTH', hops: 2, maxNodes: 24 },
    },
    impact: {
        label: 'Impact',
        blurb: 'Downstream only, critical paths to dashboards and models marked. For schema changes.',
        defaults: { direction: 'DOWNSTREAM', hops: 3, maxNodes: 30 },
    },
    column: {
        label: 'Column flow',
        blurb: 'Column-level lineage with field mappings on each edge. For migrations.',
        defaults: { direction: 'BOTH', hops: 2, maxNodes: 12 },
    },
};
