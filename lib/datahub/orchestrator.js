/**
 * DataHubOrchestrator
 *
 * chains the datahub tool surface into a single `build()` call that returns a
 * validated intermediate graph. the frontend never talks to datahub directly and
 * never sees a raw metadata payload.
 *
 * call order, and why:
 *   1. search                 resolve free text -> urn (skipped if seed is a urn)
 *   2. get_lineage            topology, hop-limited, both directions
 *   3. get_entities (batch)   ownership / domain / tags / deprecation in one call
 *   4. list_schema_fields     only for nodes that survived the first cut
 *   5. get_assertions         quality status for visual encoding
 *   6. get_dataset_queries    real query traffic, used for scoring and recipe cards
 *   7. search_documents       existing runbooks, rendered as context notes
 *
 * steps 4-6 run only on pruned survivors. that is the difference between 12 mcp
 * calls and 300.
 */
import { prune, markCriticalPaths } from './prune';
const PII_HINTS = ['pii', 'sensitive', 'gdpr', 'personal', 'confidential', 'phi'];
const TYPE_MAP = {
    DATASET: 'DATASET',
    DASHBOARD: 'DASHBOARD',
    CHART: 'CHART',
    DATA_JOB: 'DATA_JOB',
    DATA_FLOW: 'DATA_FLOW',
    MLMODEL: 'ML_MODEL',
    ML_MODEL: 'ML_MODEL',
    MLFEATURE_TABLE: 'ML_FEATURE_TABLE',
    ML_FEATURE_TABLE: 'ML_FEATURE_TABLE',
    CONTAINER: 'CONTAINER',
};
function kindOf(t) {
    return TYPE_MAP[(t ?? '').toUpperCase()] ?? 'UNKNOWN';
}
function platformOf(e) {
    return (e?.platform?.properties?.displayName ??
        e?.platform?.name?.split(':').pop() ??
        'unknown');
}
function labelOf(e) {
    const raw = e?.properties?.name ?? e?.name ?? e?.urn ?? 'unnamed';
    // datahub dataset names are often fully qualified. show the leaf, keep the rest.
    return String(raw).split('.').slice(-1)[0] || String(raw);
}
function ownersOf(e) {
    const list = e?.ownership?.owners ?? [];
    return list.map((o) => {
        const own = o.owner ?? {};
        const props = own.properties ?? {};
        return {
            urn: own.urn ?? '',
            name: props.displayName ?? own.username ?? own.name ?? 'unknown',
            kind: own.__typename === 'CorpGroup' ? 'GROUP' : 'USER',
            role: o.ownershipType?.info?.name,
            email: props.email,
        };
    });
}
function namesOf(container, key) {
    const arr = container?.[key] ?? [];
    return arr
        .map((t) => t.tag?.properties?.name ?? t.term?.properties?.name)
        .filter(Boolean);
}
export class DataHubOrchestrator {
    t;
    constructor(t) {
        this.t = t;
    }
    async resolveSeed(seed) {
        if (seed.startsWith('urn:li:'))
            return seed;
        const res = await this.t.callTool('search', {
            query: seed,
            count: 5,
            types: ['DATASET', 'DASHBOARD', 'DATA_JOB', 'MLMODEL'],
        });
        const first = res?.searchResults?.[0]?.entity;
        if (!first?.urn)
            throw new Error(`no datahub entity matched "${seed}"`);
        return first.urn;
    }
    async fetchLineage(urn, direction, hops) {
        const res = await this.t.callTool('get_lineage', {
            urn,
            direction,
            hops,
            count: 200,
        });
        const nodes = new Map();
        const edges = [];
        const sign = direction === 'UPSTREAM' ? -1 : 1;
        for (const r of res?.searchResults ?? []) {
            const e = r.entity;
            if (!e?.urn)
                continue;
            nodes.set(e.urn, {
                urn: e.urn,
                label: labelOf(e),
                qualifiedName: e.properties?.qualifiedName ?? e.properties?.name ?? e.name,
                kind: kindOf(e.type),
                platform: platformOf(e),
                domain: e.domain?.domain?.properties?.name,
                description: e.properties?.description || undefined,
                deprecated: Boolean(e.deprecation?.deprecated),
                owners: ownersOf(e),
                tags: namesOf(e.tags, 'tags'),
                glossaryTerms: namesOf(e.glossaryTerms, 'terms'),
                fields: [],
                totalFieldCount: 0,
                quality: { failingAssertions: 0, totalAssertions: 0, status: 'unknown' },
                sampleQueries: [],
                hop: sign * (r.degree ?? 1),
                weight: 0,
                gaps: [],
                reason: '',
            });
            // reconstruct edges from the returned paths so the topology is real
            // adjacency, not a star graph off the seed.
            for (const p of r.paths ?? []) {
                const path = p.path ?? [];
                for (let i = 0; i < path.length - 1; i++) {
                    const a = path[i]?.urn;
                    const b = path[i + 1]?.urn;
                    if (!a || !b)
                        continue;
                    const [from, to] = direction === 'UPSTREAM' ? [b, a] : [a, b];
                    edges.push({ from, to, kind: 'UNKNOWN', critical: false });
                }
            }
            // fallback for instances that don't return paths
            if (!(r.paths ?? []).length) {
                const [from, to] = direction === 'UPSTREAM' ? [e.urn, urn] : [urn, e.urn];
                edges.push({ from, to, kind: 'UNKNOWN', critical: false });
            }
        }
        return { nodes, edges };
    }
    async enrich(nodes) {
        // batch metadata in one call rather than n calls
        const urns = nodes.map((n) => n.urn);
        if (urns.length) {
            try {
                const ents = await this.t.callTool('get_entities', { urns });
                const byUrn = new Map((ents ?? []).filter(Boolean).map((e) => [e.urn, e]));
                for (const n of nodes) {
                    const e = byUrn.get(n.urn);
                    if (!e)
                        continue;
                    if (!n.owners.length)
                        n.owners = ownersOf(e);
                    n.domain ??= e.domain?.domain?.properties?.name;
                    n.description ??= e.properties?.description || undefined;
                    n.deprecated = n.deprecated || Boolean(e.deprecation?.deprecated);
                    if (!n.tags.length)
                        n.tags = namesOf(e.tags, 'tags');
                    if (!n.glossaryTerms.length)
                        n.glossaryTerms = namesOf(e.glossaryTerms, 'terms');
                }
            }
            catch {
                /* enrichment is additive. a failure here degrades the diagram, not the run. */
            }
        }
        // per-node detail, only for survivors
        await Promise.all(nodes.map(async (n) => {
            if (n.kind !== 'DATASET')
                return;
            const [fields, quality, queries] = await Promise.all([
                this.t.callTool('list_schema_fields', { urn: n.urn }).catch(() => null),
                this.t.callTool('get_assertions', { urn: n.urn }).catch(() => null),
                this.t.callTool('get_dataset_queries', { urn: n.urn }).catch(() => null),
            ]);
            const all = fields?.schemaMetadata?.fields ?? [];
            n.totalFieldCount = all.length;
            n.fields = all.slice(0, 12).map((f) => {
                const tags = [...namesOf(f.tags, 'tags'), ...namesOf(f.glossaryTerms, 'terms')];
                return {
                    path: f.fieldPath,
                    type: f.nativeDataType ?? 'unknown',
                    nullable: f.nullable,
                    description: f.description || undefined,
                    tags,
                    isPii: tags.some((t) => PII_HINTS.some((h) => t.toLowerCase().includes(h))),
                };
            });
            n.quality = deriveQuality(quality);
            const topFields = queries?.aggregations?.fields ?? [];
            n.sampleQueries = topFields
                .slice(0, 3)
                .map((f) => `${f.fieldName} — ${f.count} queries/mo`);
            n.gaps = [];
            if (!n.owners.length)
                n.gaps.push('no_owner');
            if (!n.description)
                n.gaps.push('no_description');
            if (!n.domain)
                n.gaps.push('no_domain');
            if (n.fields.length && n.fields.every((f) => !f.description)) {
                n.gaps.push('undocumented_fields');
            }
        }));
    }
    async contextNotes(seedUrn, label) {
        try {
            const res = await this.t.callTool('search_documents', { query: label, count: 3 });
            return (res?.searchResults ?? []).map((r) => ({
                title: r.entity?.properties?.name ?? 'untitled document',
                url: r.entity?.urn,
                excerpt: String(r.entity?.properties?.description ?? '').slice(0, 220),
            }));
        }
        catch {
            return [];
        }
    }
    async build(req) {
        const mode = req.mode ?? 'architecture';
        const hops = Math.min(req.hops ?? 2, 4);
        const maxNodes = Math.min(req.maxNodes ?? 24, 60);
        const direction = req.direction ?? (mode === 'impact' ? 'DOWNSTREAM' : 'BOTH');
        const seedUrn = await this.resolveSeed(req.seed);
        const dirs = direction === 'BOTH' ? ['UPSTREAM', 'DOWNSTREAM'] : [direction];
        const merged = new Map();
        let allEdges = [];
        for (const d of dirs) {
            const { nodes, edges } = await this.fetchLineage(seedUrn, d, hops);
            for (const [urn, n] of nodes) {
                const existing = merged.get(urn);
                // a node reachable both ways keeps the shorter hop distance
                if (!existing || Math.abs(n.hop) < Math.abs(existing.hop))
                    merged.set(urn, n);
            }
            allEdges = allEdges.concat(edges);
        }
        // the seed itself is not in its own lineage response
        if (!merged.has(seedUrn)) {
            const [self] = (await this.t
                .callTool('get_entities', { urns: [seedUrn] })
                .catch(() => [])) ?? [];
            merged.set(seedUrn, {
                urn: seedUrn,
                label: self ? labelOf(self) : seedUrn.split(',')[1] ?? seedUrn,
                qualifiedName: self?.properties?.qualifiedName,
                kind: kindOf(self?.type) === 'UNKNOWN' ? 'DATASET' : kindOf(self?.type),
                platform: self ? platformOf(self) : 'unknown',
                domain: self?.domain?.domain?.properties?.name,
                description: self?.properties?.description || undefined,
                deprecated: Boolean(self?.deprecation?.deprecated),
                owners: self ? ownersOf(self) : [],
                tags: namesOf(self?.tags, 'tags'),
                glossaryTerms: namesOf(self?.glossaryTerms, 'terms'),
                fields: [],
                totalFieldCount: 0,
                quality: { failingAssertions: 0, totalAssertions: 0, status: 'unknown' },
                sampleQueries: [],
                hop: 0,
                weight: 1,
                gaps: [],
                reason: 'seed entity',
            });
        }
        else {
            merged.get(seedUrn).hop = 0;
        }
        const discovered = [...merged.values()];
        const dedupedEdges = dedupe(allEdges);
        // first cut on topology alone, then enrich only the survivors
        const first = prune(discovered, dedupedEdges, {
            mode,
            maxNodes,
            excludeStaging: req.filters?.excludeStaging ?? false,
        });
        await this.enrich(first.nodes);
        // second pass now that we know quality, pii, and query traffic. a table with
        // failing assertions can climb back into the diagram here.
        const final = prune(first.nodes, first.edges, {
            mode,
            maxNodes,
            excludeStaging: req.filters?.excludeStaging ?? false,
        });
        const edges = mode === 'impact' ? markCriticalPaths(final.nodes, final.edges) : final.edges;
        const seedNode = final.nodes.find((n) => n.hop === 0);
        const notes = await this.contextNotes(seedUrn, seedNode?.label ?? req.seed);
        return {
            seedUrn,
            mode,
            nodes: final.nodes,
            edges,
            clusters: [...first.clusters, ...final.clusters].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i),
            contextNotes: notes,
            stats: {
                nodesDiscovered: discovered.length,
                nodesRendered: final.nodes.length,
                edgesDiscovered: dedupedEdges.length,
                edgesRendered: edges.length,
                hopsTraversed: hops,
                prunedForNoise: first.prunedForNoise + final.prunedForNoise,
            },
            trace: this.t.trace,
            generatedAtMs: Date.now(),
        };
    }
}
function dedupe(edges) {
    const seen = new Map();
    for (const e of edges) {
        if (e.from === e.to)
            continue;
        const k = `${e.from}->${e.to}`;
        if (!seen.has(k))
            seen.set(k, e);
    }
    return [...seen.values()];
}
function deriveQuality(payload) {
    const list = payload?.assertions ?? [];
    if (!list.length) {
        return { failingAssertions: 0, totalAssertions: 0, status: 'unknown' };
    }
    let failing = 0;
    let lastObservedMs;
    for (const a of list) {
        const ev = a.runEvents;
        if ((ev?.failed ?? 0) > 0)
            failing++;
        const ts = ev?.runEvents?.[0]?.timestampMillis;
        if (ts && (!lastObservedMs || ts > lastObservedMs))
            lastObservedMs = ts;
    }
    const status = failing === 0 ? 'healthy' : failing / list.length > 0.3 ? 'failing' : 'degraded';
    return { failingAssertions: failing, totalAssertions: list.length, lastObservedMs, status };
}
