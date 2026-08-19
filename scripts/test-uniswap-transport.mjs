#!/usr/bin/env node
/**
 * manual verification for lib/graph/transport.js + uniswapTopology.js.
 *
 * this hits the real Uniswap v3 subgraph through The Graph's gateway, so it
 * needs a real THEGRAPH_API_KEY (free, no card: thegraph.com/studio) and real
 * network egress — it will NOT run inside a sandboxed dev environment that
 * blocks outbound requests to thegraph.com. run it locally or in CI/Vercel.
 *
 * usage:
 *   THEGRAPH_API_KEY=... node scripts/test-uniswap-transport.mjs
 *   THEGRAPH_API_KEY=... node scripts/test-uniswap-transport.mjs 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640
 *   THEGRAPH_API_KEY=... node scripts/test-uniswap-transport.mjs USDC
 */
import { buildUniswapV3Graph } from '../lib/graph/uniswapTopology.js';

const seed = process.argv[2] ?? '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640'; // USDC/ETH 0.05% pool

if (!process.env.THEGRAPH_API_KEY) {
    console.error('THEGRAPH_API_KEY is not set. Get a free key at https://thegraph.com/studio (100k queries/month, no card).');
    process.exit(1);
}

console.log(`resolving + fetching topology for seed: ${seed}\n`);

try {
    const graph = await buildUniswapV3Graph(seed);

    console.log(`resolved as: ${graph.resolvedSeed.kind} ${graph.resolvedSeed.id}`);
    console.log(`nodes: ${graph.nodes.length}, edges: ${graph.edges.length}\n`);

    console.log('nodes:');
    for (const n of graph.nodes) {
        console.log(`  [${n.kind}] ${n.label}  (hop ${n.hop})  ${n.address ?? ''}`);
    }

    console.log('\nedges:');
    for (const e of graph.edges) {
        console.log(`  ${e.from} --${e.kind}--> ${e.to}`);
    }

    console.log('\ntrace:');
    for (const t of graph.trace) {
        console.log(`  ${t.ok ? 'ok  ' : 'FAIL'} ${t.tool}(${JSON.stringify(t.args)}) ${t.ms}ms -> ${t.resultSummary}${t.subgraphId ? `  [${t.subgraphId.slice(0, 8)}…]` : ''}`);
    }

    if (!graph.nodes.length) {
        console.error('\nno nodes returned — topology fetch is NOT solid yet.');
        process.exit(1);
    }
    console.log('\ntopology fetch looks solid.');
}
catch (err) {
    console.error('\nFAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
}
