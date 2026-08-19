/**
 * graphql documents for the uniswap-v3-subgraph schema
 * (factory / pool / token entities — stable since the v3 subgraph's first
 * release, unchanged across the official and community-mirrored deployments).
 */
export const GQL = {
    factory: /* GraphQL */ `
    query Factory {
      factories(first: 1) {
        id
        poolCount
        txCount
        totalVolumeUSD
        totalValueLockedUSD
      }
    }
  `,
    poolById: /* GraphQL */ `
    query PoolById($id: ID!) {
      pool(id: $id) {
        id
        createdAtTimestamp
        feeTier
        liquidity
        totalValueLockedUSD
        volumeUSD
        txCount
        token0 { id symbol name decimals totalValueLockedUSD volumeUSD }
        token1 { id symbol name decimals totalValueLockedUSD volumeUSD }
      }
    }
  `,
    tokenById: /* GraphQL */ `
    query TokenById($id: ID!) {
      token(id: $id) {
        id
        symbol
        name
        decimals
        volumeUSD
        totalValueLockedUSD
        poolCount
      }
    }
  `,
    poolsForToken: /* GraphQL */ `
    query PoolsForToken($id: String!, $first: Int!) {
      pools(
        where: { or: [{ token0: $id }, { token1: $id }] }
        orderBy: volumeUSD
        orderDirection: desc
        first: $first
      ) {
        id
        feeTier
        liquidity
        totalValueLockedUSD
        volumeUSD
        txCount
        token0 { id symbol name decimals }
        token1 { id symbol name decimals }
      }
    }
  `,
    searchTokenBySymbol: /* GraphQL */ `
    query SearchTokenBySymbol($symbol: String!, $first: Int!) {
      tokens(
        where: { symbol_contains_nocase: $symbol }
        orderBy: totalValueLockedUSD
        orderDirection: desc
        first: $first
      ) {
        id
        symbol
        name
        decimals
        totalValueLockedUSD
        poolCount
      }
    }
  `,
};
