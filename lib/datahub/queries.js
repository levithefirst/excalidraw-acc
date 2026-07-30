/**
 * datahub graphql documents.
 *
 * kept deliberately lean: every field here maps to something the diagram
 * actually renders. fetching more would just burn the token budget on
 * metadata nobody sees.
 */
const OWNERSHIP = `
  ownership {
    owners {
      owner {
        __typename
        ... on CorpUser { urn username properties { displayName email } }
        ... on CorpGroup { urn name properties { displayName email } }
      }
      ownershipType { urn info { name } }
    }
  }
`;
const COMMON = `
  urn
  type
  ${OWNERSHIP}
  domain { domain { urn properties { name } } }
  tags { tags { tag { urn properties { name } } } }
  glossaryTerms { terms { term { properties { name } } } }
  deprecation { deprecated note }
`;
export const GQL = {
    search: `
    query search($input: SearchAcrossEntitiesInput!) {
      searchAcrossEntities(input: $input) {
        total
        searchResults {
          entity {
            urn
            type
            ... on Dataset {
              name
              platform { name properties { displayName } }
              properties { name qualifiedName description }
              ${OWNERSHIP}
              domain { domain { properties { name } } }
            }
            ... on Dashboard {
              properties { name description }
              platform { name properties { displayName } }
            }
            ... on DataJob { properties { name description } }
            ... on MLModel { properties { name description } }
          }
        }
      }
    }
  `,
    entities: `
    query entities($urns: [String!]!) {
      entities(urns: $urns) {
        ${COMMON}
        ... on Dataset {
          name
          platform { name properties { displayName } }
          properties { name qualifiedName description }
          subTypes { typeNames }
        }
        ... on Dashboard {
          properties { name description }
          platform { name properties { displayName } }
        }
        ... on Chart { properties { name description } }
        ... on DataJob { properties { name description } }
        ... on DataFlow { properties { name description } }
        ... on MLModel { properties { name description } }
        ... on MLFeatureTable { properties { name description } }
      }
    }
  `,
    lineage: `
    query lineage($input: SearchAcrossLineageInput!) {
      searchAcrossLineage(input: $input) {
        total
        searchResults {
          degree
          paths {
            path { urn type }
          }
          entity {
            urn
            type
            ... on Dataset {
              name
              platform { name properties { displayName } }
              properties { name qualifiedName description }
              ${OWNERSHIP}
              domain { domain { properties { name } } }
              deprecation { deprecated }
            }
            ... on Dashboard {
              properties { name description }
              platform { name properties { displayName } }
            }
            ... on DataJob { properties { name description } }
            ... on MLModel { properties { name description } }
          }
        }
      }
    }
  `,
    schemaFields: `
    query schemaFields($urn: String!) {
      dataset(urn: $urn) {
        urn
        schemaMetadata {
          fields {
            fieldPath
            nativeDataType
            nullable
            description
            glossaryTerms { terms { term { properties { name } } } }
            tags { tags { tag { properties { name } } } }
          }
        }
      }
    }
  `,
    datasetQueries: `
    query datasetQueries($urn: String!) {
      dataset(urn: $urn) {
        usageStats(resource: $urn, range: MONTH) {
          buckets { bucket metrics { totalSqlQueries } }
          aggregations {
            uniqueUserCount
            totalSqlQueries
            fields { fieldName count }
          }
        }
      }
    }
  `,
    assertions: `
    query assertions($urn: String!) {
      dataset(urn: $urn) {
        assertions(start: 0, count: 20) {
          total
          assertions {
            urn
            runEvents(status: COMPLETE, limit: 1) {
              failed
              succeeded
              runEvents { timestampMillis result { type } }
            }
          }
        }
      }
    }
  `,
    addTags: `
    mutation addTags($input: AddTagsInput!) {
      addTags(input: $input)
    }
  `,
    updateDescription: `
    mutation updateDescription($input: DescriptionUpdateInput!) {
      updateDescription(input: $input)
    }
  `,
};
