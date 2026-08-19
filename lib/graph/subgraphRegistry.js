/**
 * curated public subgraph endpoints, queried through The Graph's decentralized
 * network gateway. hosted-service endpoints (api.thegraph.com/subgraphs/name/...)
 * were sunset in 2024 — every endpoint here goes through gateway.thegraph.com and
 * needs a Studio API key (free tier: 100k queries/month, no card required).
 *
 * https://gateway.thegraph.com/api/<API_KEY>/subgraphs/id/<SUBGRAPH_ID>
 *
 * uniswap's own subgraph ID moves when they redeploy or fix indexing bugs, so
 * this is a small ordered list, not a single constant. transport.js tries them
 * in order and falls back to the next one on a bad response, so a stale ID
 * doesn't take the whole demo down.
 */
export const UNISWAP_V3_MAINNET_SUBGRAPH_IDS = [
    // "Uniswap V3 Official" — published by the Uniswap Foundation, mainnet.
    'EN9rjKtzNitTEb5hgt8bmiyzzhwBpJrJaRihkg8Me8Rr',
    // "Uniswap v3 Ethereum" — community-maintained mirror, same schema.
    'ELUcwgpm14LKPLrBRuVvPvNKHQ9HvwmtKgKSH6123cr7',
];
export const SUBGRAPH_REGISTRY = {
    'uniswap-v3': {
        label: 'Uniswap V3 (Ethereum mainnet)',
        subgraphIds: UNISWAP_V3_MAINNET_SUBGRAPH_IDS,
        // demo-safe starting points so a judge never has to type an address
        quickPicks: [
            { label: 'USDC / ETH 0.05%', seed: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640' },
            { label: 'WBTC / ETH 0.3%', seed: '0xcbcdf9626bc03e24f779434178a73a0b4bad62ed' },
            { label: 'DAI / USDC 0.01%', seed: '0x5777d92f208679db4b9778590fa3cab3ac9e2168' },
        ],
    },
};
export function gatewayUrl(subgraphId, apiKey) {
    return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
}
