/**
 * layout engine
 *
 * fully deterministic. the same graph produces the same canvas every time, which
 * matters because these diagrams get pasted into rfcs and post-mortems and
 * compared across runs.
 *
 * the llm does not place anything. it never sees coordinates. asking a model to
 * emit x/y for 30 nodes produces overlapping boxes and crossed arrows, and it
 * burns tokens on arithmetic.
 *
 * structure: hop distance drives the x axis (upstream left, seed centre,
 * downstream right). domain drives vertical banding within a tier. platform
 * drives ordering inside a band so same-warehouse assets sit together.
 */
export const BOX = {
    w: 240,
    minH: 92,
    fieldRowH: 18,
    hGap: 160,
    vGap: 44,
    bandGap: 88,
    padding: 16,
};
/** how tall a node box needs to be given what we're drawing inside it */
function heightFor(n, detail) {
    let h = BOX.minH;
    if (detail && n.fields.length) {
        h += Math.min(n.fields.length, 8) * BOX.fieldRowH + 10;
    }
    if (n.owners.length)
        h += 18;
    if (n.sampleQueries.length)
        h += 16;
    return h;
}
export function layoutGraph(graph, opts = {}) {
    const detail = opts.detail ?? true;
    // 1. tier by hop. sparse hops are compacted so an empty hop level doesn't
    //    leave a gutter in the middle of the canvas.
    const hops = [...new Set(graph.nodes.map((n) => n.hop))].sort((a, b) => a - b);
    const tierOf = new Map(hops.map((h, i) => [h, i]));
    // 2. band by domain. undomained assets fall into one trailing band so the
    //    metadata gap is visible rather than hidden.
    const bandName = (n) => n.domain ?? 'no domain assigned';
    const bandOrder = [...new Set(graph.nodes.map(bandName))].sort((a, b) => {
        if (a === 'no domain assigned')
            return 1;
        if (b === 'no domain assigned')
            return -1;
        return a.localeCompare(b);
    });
    // 3. bucket: band -> tier -> nodes, ordered by platform then weight
    const buckets = new Map();
    for (const n of graph.nodes) {
        const b = bandName(n);
        const t = tierOf.get(n.hop);
        const byTier = buckets.get(b) ?? new Map();
        const arr = byTier.get(t) ?? [];
        arr.push(n);
        byTier.set(t, arr);
        buckets.set(b, byTier);
    }
    for (const byTier of buckets.values()) {
        for (const arr of byTier.values()) {
            arr.sort((a, b) => a.platform.localeCompare(b.platform) || b.weight - a.weight);
        }
    }
    const colX = (tier) => tier * (BOX.w + BOX.hGap);
    const placed = [];
    const bands = [];
    let cursorY = 0;
    for (const band of bandOrder) {
        const byTier = buckets.get(band);
        const bandTop = cursorY;
        let bandBottom = cursorY;
        for (const [tier, nodes] of byTier) {
            let y = cursorY;
            for (const n of nodes) {
                const h = heightFor(n, detail);
                placed.push({ node: n, x: colX(tier), y, w: BOX.w, h, tier, band });
                y += h + BOX.vGap;
            }
            bandBottom = Math.max(bandBottom, y - BOX.vGap);
        }
        bands.push({
            label: band,
            x: -BOX.padding,
            y: bandTop - BOX.padding - 22,
            w: hops.length * (BOX.w + BOX.hGap) - BOX.hGap + BOX.padding * 2,
            h: bandBottom - bandTop + BOX.padding * 2 + 22,
        });
        cursorY = bandBottom + BOX.bandGap;
    }
    // 4. collapsed staging clusters sit in their tier, below everything else
    const clusters = [];
    let clusterY = cursorY;
    for (const c of graph.clusters) {
        const tier = tierOf.get(c.hop) ?? 0;
        clusters.push({ cluster: c, x: colX(tier), y: clusterY, w: BOX.w, h: 64 });
        clusterY += 64 + BOX.vGap;
    }
    const width = hops.length * (BOX.w + BOX.hGap) - BOX.hGap;
    const height = Math.max(cursorY, clusterY) + BOX.padding;
    return { nodes: placed, clusters, bands, width, height };
}
/** tier labels for the canvas header row */
export function tierLabels(graph) {
    const hops = [...new Set(graph.nodes.map((n) => n.hop))].sort((a, b) => a - b);
    return hops.map((h, i) => ({
        label: h === 0 ? 'seed' : h < 0 ? `${Math.abs(h)} hop upstream` : `${h} hop downstream`,
        x: i * (BOX.w + BOX.hGap),
    }));
}
