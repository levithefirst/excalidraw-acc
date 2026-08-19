/**
 * seed resolution + topology fetch for Uniswap v3.
 *
 * this is the piece that proves the transport layer is solid: given whatever
 * a user pastes in (a pool address, a token address, or a token symbol), come
 * back with a real factory -> pool -> token graph, built from the same node
 * shape DataHub's orchestrator used (see lib/datahub/orchestrator.js) so the
 * prune/layout/excalidraw modules can be ported without touching their
 * interfaces.
 */
import { UNISWAP_V3_MAINNET_SUBGRAPH_IDS } from './subgraphRegistry.js';
import { makeUniswapV3Transport } from './transport.js';
const ADDRESS_RE = /^0x[a-f0-9]{40}$/i;
function feePct(feeTier) {
    const n = Number(feeTier);
    return Number.isFinite(n) ? `${(n / 10_000).toFixed(2)}%` : 'unknown';
}
function tokenNode(t, hop) {
    return {
        urn: `uniswap:token:${t.id}`,
        kind: 'TOKEN',
        label: t.symbol ?? t.id.slice(0, 8),
        address: t.id,
        name: t.name,
        decimals: t.decimals != null ? Number(t.decimals) : undefined,
        tvlUsd: t.totalValueLockedUSD != null ? Number(t.totalValueLockedUSD) : undefined,
        volumeUsd: t.volumeUSD != null ? Number(t.volumeUSD) : undefined,
        hop,
    };
}
function poolNode(p, hop) {
    return {
        urn: `uniswap:pool:${p.id}`,
        kind: 'POOL',
        label: `${p.token0?.symbol ?? '?'} / ${p.token1?.symbol ?? '?'} ${feePct(p.feeTier)}`,
        address: p.id,
        feeTier: p.feeTier != null ? Number(p.feeTier) : undefined,
        liquidity: p.liquidity,
        tvlUsd: p.totalValueLockedUSD != null ? Number(p.totalValueLockedUSD) : undefined,
        volumeUsd: p.volumeUSD != null ? Number(p.volumeUSD) : undefined,
        txCount: p.txCount != null ? Number(p.txCount) : undefined,
        createdAtMs: p.createdAtTimestamp ? Number(p.createdAtTimestamp) * 1000 : undefined,
        hop,
    };
}
function factoryNode(f) {
    return {
        urn: `uniswap:factory:${f.id}`,
        kind: 'FACTORY',
        label: 'Uniswap V3 Factory',
        address: f.id,
        poolCount: f.poolCount != null ? Number(f.poolCount) : undefined,
        totalVolumeUsd: f.totalVolumeUSD != null ? Number(f.totalVolumeUSD) : undefined,
        hop: -1,
    };
}
/**
 * accepts a pool address, a token address, or a bare token symbol (e.g. "USDC")
 * and returns { kind: 'pool' | 'token', id } for the topology fetch to branch on.
 */
export async function resolveSeed(transport, seed) {
    const raw = seed.trim();
    if (ADDRESS_RE.test(raw)) {
        // callTool only throws on a real transport failure (network, timeout,
        // http, graphql error) — a "no such pool" lookup resolves with
        // null/undefined, it does not throw. so a real failure here must
        // propagate, not get treated as "try the next entity type".
        const id = raw.toLowerCase();
        const pool = await transport.callTool('get_pool', { id });
        if (pool)
            return { kind: 'pool', id, entity: pool };
        const token = await transport.callTool('get_token', { id });
        if (token)
            return { kind: 'token', id, entity: token };
        throw new Error(`no Uniswap v3 pool or token found for address ${raw}`);
    }
    const matches = await transport.callTool('search_token', { symbol: raw, first: 5 });
    const top = matches?.[0];
    if (!top)
        throw new Error(`no Uniswap v3 token matched "${raw}"`);
    return { kind: 'token', id: top.id, entity: top };
}
/**
 * factory -> pool -> token0/token1 topology for a resolved seed.
 *   - pool seed:  factory, the pool itself, its two tokens
 *   - token seed: factory, the token, its top pools by volume, each pool's
 *                 other-side token
 */
export async function fetchUniswapV3Topology(transport, resolved, opts = {}) {
    const maxPools = opts.maxPoolsPerToken ?? 8;
    const nodes = new Map();
    const edges = [];
    const factory = await transport.callTool('get_factory', {}).catch(() => null);
    if (factory)
        nodes.set(`uniswap:factory:${factory.id}`, factoryNode(factory));
    const addEdge = (from, to, label) => edges.push({ from, to, kind: label });
    if (resolved.kind === 'pool') {
        const p = resolved.entity;
        const pUrn = `uniswap:pool:${p.id}`;
        nodes.set(pUrn, poolNode(p, 0));
        if (factory)
            addEdge(`uniswap:factory:${factory.id}`, pUrn, 'DEPLOYS');
        for (const t of [p.token0, p.token1]) {
            if (!t)
                continue;
            const tUrn = `uniswap:token:${t.id}`;
            nodes.set(tUrn, tokenNode(t, 1));
            addEdge(pUrn, tUrn, 'HOLDS');
        }
    }
    else {
        const t = resolved.entity;
        const tUrn = `uniswap:token:${t.id}`;
        nodes.set(tUrn, tokenNode(t, 0));
        const pools = (await transport.callTool('get_pools_for_token', {
            id: resolved.id,
            first: maxPools,
        })) ?? [];
        for (const p of pools) {
            const pUrn = `uniswap:pool:${p.id}`;
            nodes.set(pUrn, poolNode(p, 1));
            if (factory)
                addEdge(`uniswap:factory:${factory.id}`, pUrn, 'DEPLOYS');
            addEdge(pUrn, tUrn, 'HOLDS');
            const other = p.token0?.id === resolved.id ? p.token1 : p.token0;
            if (other) {
                const oUrn = `uniswap:token:${other.id}`;
                if (!nodes.has(oUrn))
                    nodes.set(oUrn, tokenNode(other, 2));
                addEdge(pUrn, oUrn, 'HOLDS');
            }
        }
    }
    return { nodes: [...nodes.values()], edges };
}
export async function buildUniswapV3Graph(seed, opts = {}) {
    const transport = makeUniswapV3Transport(UNISWAP_V3_MAINNET_SUBGRAPH_IDS);
    const resolved = await resolveSeed(transport, seed);
    const graph = await fetchUniswapV3Topology(transport, resolved, opts);
    return { ...graph, resolvedSeed: resolved, trace: transport.trace };
}
