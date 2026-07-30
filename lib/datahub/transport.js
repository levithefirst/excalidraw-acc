/**
 * datahub transport layer
 *
 * two implementations behind one interface:
 *
 *   McpTransport      - speaks json-rpc to the datahub mcp server over streamable
 *                       http. this is the path judges care about. works against
 *                       datahub cloud (/mcp) or a self-hosted mcp bridge.
 *   GraphQLTransport   - hits /api/graphql directly. the mcp server wraps these
 *                       same resolvers, so this is the honest fallback for oss
 *                       datahub quickstart where mcp runs over stdio and can't be
 *                       reached from a serverless function.
 *
 * the orchestrator only ever sees `callTool`. swap transports with one env var.
 */
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
/* ------------------------------------------------------------------ */
/* mcp: streamable http json-rpc                                       */
/* ------------------------------------------------------------------ */
export class McpTransport {
    endpoint;
    token;
    kind = 'mcp';
    trace = [];
    id = 0;
    sessionId = null;
    constructor(endpoint, token) {
        this.endpoint = endpoint;
        this.token = token;
    }
    async rpc(method, params) {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${this.token}`,
        };
        if (this.sessionId)
            headers['Mcp-Session-Id'] = this.sessionId;
        const res = await fetch(this.endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
        });
        const sid = res.headers.get('Mcp-Session-Id');
        if (sid)
            this.sessionId = sid;
        if (!res.ok) {
            throw new Error(`mcp ${method} failed: ${res.status} ${await res.text()}`);
        }
        const raw = await res.text();
        // streamable http may return sse framing. pull the last data: line.
        const body = raw.startsWith('event:') || raw.includes('\ndata:')
            ? raw
                .split('\n')
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trim())
                .filter(Boolean)
                .pop() ?? '{}'
            : raw;
        const parsed = JSON.parse(body);
        if (parsed.error)
            throw new Error(`mcp ${method}: ${parsed.error.message}`);
        return parsed.result;
    }
    async initialize() {
        await this.rpc('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'sketchdrop', version: '1.0.0' },
        });
    }
    async callTool(tool, args) {
        const t0 = Date.now();
        try {
            const result = await this.rpc('tools/call', { name: tool, arguments: args });
            // mcp returns content blocks. datahub tools return json in a text block.
            const text = (result.content ?? [])
                .filter((b) => b.type === 'text' && b.text)
                .map((b) => b.text)
                .join('\n');
            let value = text;
            try {
                value = JSON.parse(text);
            }
            catch {
                /* not json, keep the text */
            }
            this.trace.push({
                tool,
                args,
                ms: Date.now() - t0,
                resultSummary: summarize(value),
                ok: !result.isError,
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
/* ------------------------------------------------------------------ */
/* graphql fallback                                                    */
/* ------------------------------------------------------------------ */
import { GQL } from './queries';
/**
 * maps the mcp tool surface onto datahub graphql operations so the
 * orchestrator code is identical regardless of transport.
 */
const TOOL_TO_GQL = {
    search: {
        query: GQL.search,
        vars: (a) => ({
            input: {
                types: a.types ?? null,
                query: a.query ?? '*',
                start: 0,
                count: a.count ?? 10,
                orFilters: a.orFilters ?? null,
            },
        }),
        pick: (d) => d.searchAcrossEntities,
    },
    get_entities: {
        query: GQL.entities,
        vars: (a) => ({ urns: a.urns }),
        pick: (d) => d.entities,
    },
    get_lineage: {
        query: GQL.lineage,
        vars: (a) => ({
            input: {
                urn: a.urn,
                direction: a.direction ?? 'DOWNSTREAM',
                start: 0,
                count: a.count ?? 100,
                query: '*',
                orFilters: [
                    {
                        and: [
                            {
                                field: 'degree',
                                condition: 'EQUAL',
                                values: Array.from({ length: a.hops ?? 2 }, (_, i) => String(i + 1)),
                            },
                        ],
                    },
                ],
            },
        }),
        pick: (d) => d.searchAcrossLineage,
    },
    list_schema_fields: {
        query: GQL.schemaFields,
        vars: (a) => ({ urn: a.urn }),
        pick: (d) => d.dataset,
    },
    get_dataset_queries: {
        query: GQL.datasetQueries,
        vars: (a) => ({ urn: a.urn }),
        pick: (d) => d.dataset?.usageStats,
    },
    get_assertions: {
        query: GQL.assertions,
        vars: (a) => ({ urn: a.urn }),
        pick: (d) => d.dataset?.assertions,
    },
    search_documents: {
        query: GQL.search,
        vars: (a) => ({
            input: { types: ['DOCUMENT'], query: a.query ?? '*', start: 0, count: a.count ?? 5 },
        }),
        pick: (d) => d.searchAcrossEntities,
    },
    add_tags: {
        query: GQL.addTags,
        vars: (a) => ({ input: { tagUrns: a.tagUrns, resourceUrn: a.resourceUrn, subResource: a.subResource ?? null, subResourceType: a.subResource ? 'DATASET_FIELD' : null } }),
        pick: (d) => d.addTags,
    },
    update_description: {
        query: GQL.updateDescription,
        vars: (a) => ({ input: { description: a.description, resourceUrn: a.resourceUrn, subResource: a.subResource ?? null, subResourceType: a.subResource ? 'DATASET_FIELD' : null } }),
        pick: (d) => d.updateDescription,
    },
};
export class GraphQLTransport {
    baseUrl;
    token;
    kind = 'graphql';
    trace = [];
    constructor(baseUrl, token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }
    async callTool(tool, args) {
        const mapping = TOOL_TO_GQL[tool];
        if (!mapping)
            throw new Error(`no graphql mapping for tool "${tool}"`);
        const t0 = Date.now();
        try {
            const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/graphql`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify({ query: mapping.query, variables: mapping.vars(args) }),
            });
            if (!res.ok)
                throw new Error(`graphql ${res.status}: ${await res.text()}`);
            const json = await res.json();
            if (json.errors?.length)
                throw new Error(json.errors.map((e) => e.message).join('; '));
            const value = mapping.pick(json.data);
            this.trace.push({
                tool,
                args,
                ms: Date.now() - t0,
                resultSummary: summarize(value),
                ok: true,
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
/* ------------------------------------------------------------------ */
export async function makeTransport() {
    const mcpUrl = process.env.DATAHUB_MCP_URL;
    const gmsUrl = process.env.DATAHUB_GMS_URL;
    const token = process.env.DATAHUB_TOKEN;
    if (!token)
        throw new Error('DATAHUB_TOKEN is not set');
    if (mcpUrl) {
        const t = new McpTransport(mcpUrl, token);
        await t.initialize();
        return t;
    }
    if (gmsUrl)
        return new GraphQLTransport(gmsUrl, token);
    throw new Error('set DATAHUB_MCP_URL or DATAHUB_GMS_URL');
}
