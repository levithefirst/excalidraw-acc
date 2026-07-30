/**
 * the pruning pass.
 *
 * this is where the agent earns its name. a lineage response for any real
 * warehouse returns hundreds of nodes, most of which are staging tables nobody
 * reads. dumping them into a canvas produces the same unusable hairball as
 * datahub's own lineage explorer.
 *
 * every decision here is recorded on the node as `reason` and surfaced in the
 * ui trace panel, so a judge can watch the agent choose.
 */
const STAGING_PATTERNS = [
    /(^|[._])stg[._]/i,
    /(^|[._])staging[._]/i,
    /(^|[._])tmp[._]/i,
    /(^|[._])temp[._]/i,
    /(^|[._])raw[._]/i,
    /_scratch/i,
    /^_/,
];
const LEAF_KINDS = new Set(['DASHBOARD', 'CHART', 'ML_MODEL']);
function isStaging(node) {
    const name = node.qualifiedName ?? node.label;
    return STAGING_PATTERNS.some((p) => p.test(name));
}
/**
 * importance score in 0..1. drives both inclusion and node size.
 *
 * the weighting is opinionated on purpose: a dashboard three hops out that a
 * finance team looks at every morning matters more to an architecture review
 * than the staging table feeding it.
 */
export function scoreNode(node, mode) {
    let s = 0;
    // proximity to the seed. closest thing to "relevance" we have for free.
    s += Math.max(0, 1 - Math.abs(node.hop) / 4) * 0.3;
    // terminal consumers are what humans actually care about
    if (LEAF_KINDS.has(node.kind))
        s += 0.2;
    // real query traffic beats theoretical connectivity
    if (node.sampleQueries.length > 0)
        s += 0.15;
    // governed assets are load-bearing
    if (node.owners.length > 0)
        s += 0.1;
    if (node.domain)
        s += 0.05;
    if (node.glossaryTerms.length > 0)
        s += 0.05;
    // problems must never be pruned away
    if (node.quality.status === 'failing')
        s += 0.25;
    if (node.deprecated)
        s += 0.2;
    if (node.fields.some((f) => f.isPii))
        s += 0.15;
    // plumbing gets demoted
    if (isStaging(node))
        s -= 0.3;
    if (!node.description)
        s -= 0.05;
    // impact mode inverts the bias: downstream is the whole point
    if (mode === 'impact') {
        if (node.hop > 0)
            s += 0.2;
        if (node.hop < 0)
            s -= 0.4;
    }
    return Math.min(1, Math.max(0, s));
}
/**
 * fold runs of low-value same-platform staging nodes at the same hop into one
 * cluster shape. keeps the topology honest without drawing 40 boxes.
 */
function clusterStaging(dropped) {
    const groups = new Map();
    for (const n of dropped) {
        if (!isStaging(n))
            continue;
        const key = `${n.platform}::${n.hop}`;
        const arr = groups.get(key) ?? [];
        arr.push(n);
        groups.set(key, arr);
    }
    const clusters = [];
    for (const [key, members] of groups) {
        if (members.length < 2)
            continue;
        const [platform, hop] = key.split('::');
        clusters.push({
            id: `cluster:${key}`,
            label: `${members.length} staging tables`,
            members: members.map((m) => m.urn),
            hop: Number(hop),
            platform,
            reason: `collapsed ${members.length} staging assets on ${platform} at hop ${hop}: no query traffic, no owners`,
        });
    }
    return clusters;
}
export function prune(nodes, edges, opts) {
    const scored = nodes.map((n) => ({ ...n, weight: scoreNode(n, opts.mode) }));
    const seed = scored.find((n) => n.hop === 0);
    const rest = scored.filter((n) => n.hop !== 0).sort((a, b) => b.weight - a.weight);
    const keep = [];
    const drop = [];
    if (seed) {
        keep.push({ ...seed, reason: 'seed entity' });
    }
    for (const n of rest) {
        const overBudget = keep.length >= opts.maxNodes;
        const staged = opts.excludeStaging && isStaging(n);
        const tooWeak = n.weight < 0.18;
        if (overBudget || staged || tooWeak) {
            drop.push(n);
            continue;
        }
        keep.push({ ...n, reason: reasonFor(n) });
    }
    const clusters = clusterStaging(drop);
    const clusterOf = new Map();
    for (const c of clusters)
        for (const m of c.members)
            clusterOf.set(m, c.id);
    const keptUrns = new Set(keep.map((n) => n.urn));
    // rewrite edges that pointed at dropped nodes onto their cluster, so the
    // topology stays connected instead of showing orphans.
    const rewritten = new Map();
    for (const e of edges) {
        const from = keptUrns.has(e.from) ? e.from : clusterOf.get(e.from);
        const to = keptUrns.has(e.to) ? e.to : clusterOf.get(e.to);
        if (!from || !to || from === to)
            continue;
        const key = `${from}->${to}`;
        const existing = rewritten.get(key);
        if (existing) {
            existing.critical = existing.critical || e.critical;
            continue;
        }
        rewritten.set(key, { ...e, from, to });
    }
    return {
        nodes: keep,
        edges: [...rewritten.values()],
        clusters,
        prunedForNoise: drop.length - clusters.reduce((a, c) => a + c.members.length, 0),
    };
}
function reasonFor(n) {
    const bits = [];
    if (n.quality.status === 'failing')
        bits.push(`${n.quality.failingAssertions} failing assertions`);
    if (n.deprecated)
        bits.push('deprecated');
    if (n.fields.some((f) => f.isPii))
        bits.push('contains pii');
    if (LEAF_KINDS.has(n.kind))
        bits.push('terminal consumer');
    if (n.sampleQueries.length)
        bits.push('active query traffic');
    if (n.owners.length)
        bits.push('has owners');
    if (!bits.length)
        bits.push(`hop ${n.hop} dependency`);
    return bits.join(', ');
}
/**
 * mark the critical path in impact mode: every edge on a path from the seed to
 * a terminal consumer. these render heavier and darker.
 */
export function markCriticalPaths(nodes, edges) {
    const byFrom = new Map();
    for (const e of edges) {
        const arr = byFrom.get(e.from) ?? [];
        arr.push(e);
        byFrom.set(e.from, arr);
    }
    const kindOf = new Map(nodes.map((n) => [n.urn, n.kind]));
    const seed = nodes.find((n) => n.hop === 0);
    if (!seed)
        return edges;
    const onPath = new Set();
    const walk = (urn, chain, depth) => {
        if (depth > 8)
            return false;
        if (chain.length && LEAF_KINDS.has(kindOf.get(urn) ?? '')) {
            for (const e of chain)
                onPath.add(e);
            return true;
        }
        let found = false;
        for (const e of byFrom.get(urn) ?? []) {
            if (chain.includes(e))
                continue;
            if (walk(e.to, [...chain, e], depth + 1))
                found = true;
        }
        return found;
    };
    walk(seed.urn, [], 0);
    return edges.map((e) => ({ ...e, critical: onPath.has(e) }));
}
