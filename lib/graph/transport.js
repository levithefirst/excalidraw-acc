/**
 * subgraph transport layer
 *
 * one job: turn `callTool(tool, args)` into a GraphQL POST against The Graph's
 * gateway and come back with clean JSON, the same interface shape as
 * lib/datahub/transport.js so the orchestrator port in the next step is a
 * find-and-replace, not a redesign.
 *
 * two reliability concerns that are specific to querying a public indexer
 * instead of a service you run yourself:
 *
 *   1. subgraph IDs move. Uniswap redeploys occasionally (indexing fixes,
 *      schema tweaks) and the old ID can start 404ing or falling behind. this
 *      transport is handed an ordered list of candidate IDs and fails over to
 *      the next one, remembering which one worked so later calls skip straight
 *      to it.
 *   2. gateway queries cost queries against the caller's free-tier allowance
 *      and can be slow under load. every call has a hard timeout and every
 *      call is traced (tool, args, latency, ok/fail) the same way DataHub
 *      calls are, so the UI can show real pipeline steps instead of a spinner.
 */
import { GQL } from './queries.js';
import { gatewayUrl } from './subgraphRegistry.js';
function summarize(v) {
    if (v == null)
        return 'null';
    if (Array.isArray(v))
        return `array(${v.length})`;
    if (typeof v === 'object') {
        const keys = Object.keys(v);
        return `object{${keys.slice(0, 4).join(',')}${keys.length > 4 ? ',…' : ''}}`;
    }
    return String(v).slice(0, 80);
}
const TOOL_TO_GQL = {
    get_factory: {
        query: GQL.factory,
        vars: () => ({}),
        pick: (d) => d.factories?.[0],
    },
    get_pool: {
        query: GQL.poolById,
        vars: (a) => ({ id: a.id.toLowerCase() }),
        pick: (d) => d.pool,
    },
    get_token: {
        query: GQL.tokenById,
        vars: (a) => ({ id: a.id.toLowerCase() }),
        pick: (d) => d.token,
    },
    get_pools_for_token: {
        query: GQL.poolsForToken,
        vars: (a) => ({ id: a.id.toLowerCase(), first: a.first ?? 10 }),
        pick: (d) => d.pools,
    },
    search_token: {
        query: GQL.searchTokenBySymbol,
        vars: (a) => ({ symbol: a.symbol, first: a.first ?? 5 }),
        pick: (d) => d.tokens,
    },
};
const TIMEOUT_MS = 10_000;
export class SubgraphTransport {
    subgraphIds;
    apiKey;
    kind = 'subgraph';
    trace = [];
    // sticky index — once an ID answers successfully we stop probing the others
    workingIndex = 0;
    constructor(subgraphIds, apiKey) {
        if (!subgraphIds.length)
            throw new Error('SubgraphTransport needs at least one subgraph ID');
        this.subgraphIds = subgraphIds;
        this.apiKey = apiKey;
    }
    async postOnce(subgraphId, query, variables) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(gatewayUrl(subgraphId, this.apiKey), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, variables }),
                signal: controller.signal,
            });
            if (!res.ok) {
                throw new Error(`subgraph ${subgraphId} http ${res.status}: ${(await res.text()).slice(0, 200)}`);
            }
            const json = await res.json();
            if (json.errors?.length) {
                throw new Error(`subgraph ${subgraphId} graphql error: ${json.errors.map((e) => e.message).join('; ')}`);
            }
            return json.data;
        }
        finally {
            clearTimeout(timer);
        }
    }
    /**
     * tries subgraphIds starting from the last-known-good index, wrapping
     * around once. a single flaky/renamed deployment never fails a demo.
     */
    async postWithFailover(query, variables) {
        const n = this.subgraphIds.length;
        let lastErr;
        for (let i = 0; i < n; i++) {
            const idx = (this.workingIndex + i) % n;
            try {
                const data = await this.postOnce(this.subgraphIds[idx], query, variables);
                this.workingIndex = idx;
                return data;
            }
            catch (err) {
                lastErr = err;
            }
        }
        throw lastErr ?? new Error('no subgraph endpoints configured');
    }
    async callTool(tool, args) {
        const mapping = TOOL_TO_GQL[tool];
        if (!mapping)
            throw new Error(`no subgraph mapping for tool "${tool}"`);
        const t0 = Date.now();
        try {
            const data = await this.postWithFailover(mapping.query, mapping.vars(args));
            const value = mapping.pick(data);
            this.trace.push({
                tool,
                args,
                ms: Date.now() - t0,
                resultSummary: summarize(value),
                ok: true,
                subgraphId: this.subgraphIds[this.workingIndex],
            });
            return value;
        }
        catch (err) {
            this.trace.push({
                tool,
                args,
                ms: Date.now() - t0,
                resultSummary: err instanceof Error ? err.message : 'failed',
                ok: false,
            });
            throw err;
        }
    }
}
export function makeUniswapV3Transport(subgraphIds) {
    const apiKey = process.env.THEGRAPH_API_KEY;
    if (!apiKey)
        throw new Error('THEGRAPH_API_KEY is not set — get a free key at thegraph.com/studio (100k queries/month, no card)');
    return new SubgraphTransport(subgraphIds, apiKey);
}
