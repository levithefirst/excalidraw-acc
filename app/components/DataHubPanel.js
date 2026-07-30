"use client";

/**
 * DataHubPanel
 *
 * replaces sketchdrop's blank prompt box for datahub mode. the point of the ui is
 * to make the agent's work visible: what it searched, what it kept, what it threw
 * away and why. that trace rail down the left is the thing judges watch.
 *
 * no browser storage. all state lives in react.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MODES, annotate, applyDescription, applyTag, buildGraph, render, saveDiagram, searchEntities, summarize, } from '../../lib/datahub/client';
const T = {
    bg: '#161616',
    raised: '#1d1d1d',
    hairline: '#2a2a2a',
    text: '#ededea',
    muted: '#8a8a85',
    ember: '#af3433',
    good: '#6f9e7d',
    warn: '#b8913f',
    mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace",
};
const PHASE_COPY = {
    idle: 'Pick an asset to start',
    resolving: 'Resolving entity in DataHub',
    traversing: 'Walking lineage',
    enriching: 'Reading schemas, assertions, query traffic',
    annotating: 'Applying refinement',
    ready: 'Canvas ready',
    error: 'Something broke',
};
export default function DataHubPanel({ onScene }) {
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState([]);
    const [seed, setSeed] = useState(null);
    const [mode, setMode] = useState('architecture');
    const [hops, setHops] = useState(2);
    const [excludeStaging, setExcludeStaging] = useState(true);
    const [refine, setRefine] = useState('');
    const [phase, setPhase] = useState('idle');
    const [error, setError] = useState(null);
    const [graph, setGraph] = useState(null);
    const [ann, setAnn] = useState(null);
    const [applied, setApplied] = useState(new Set());
    const [saveNote, setSaveNote] = useState(null);
    const searchTimer = useRef(null);
    /* -------- entity search, debounced -------- */
    useEffect(() => {
        if (query.trim().length < 2) {
            setHits([]);
            return;
        }
        if (searchTimer.current)
            window.clearTimeout(searchTimer.current);
        searchTimer.current = window.setTimeout(async () => {
            try {
                setHits(await searchEntities(query.trim()));
            }
            catch {
                setHits([]);
            }
        }, 260);
        return () => {
            if (searchTimer.current)
                window.clearTimeout(searchTimer.current);
        };
    }, [query]);
    /* -------- generate -------- */
    const generate = useCallback(async () => {
        if (!seed)
            return;
        setError(null);
        setSaveNote(null);
        setAnn(null);
        setApplied(new Set());
        try {
            setPhase('resolving');
            const preset = MODES[mode].defaults;
            setPhase('traversing');
            const g = await buildGraph({
                seed: seed.urn,
                mode,
                hops,
                direction: preset.direction,
                maxNodes: preset.maxNodes,
                filters: { excludeStaging },
            });
            setGraph(g);
            let keep;
            if (refine.trim()) {
                setPhase('annotating');
                const a = await annotate(g, refine.trim());
                setAnn(a);
                keep = a.keep.filter((u) => !a.drop.includes(u));
            }
            else {
                setPhase('enriching');
                annotate(g).then(setAnn).catch(() => undefined);
            }
            onScene(render(g, keep), `${seed.name}-${mode}.excalidraw`);
            setPhase('ready');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'graph build failed');
            setPhase('error');
        }
    }, [seed, mode, hops, excludeStaging, refine, onScene]);
    /* -------- write-back -------- */
    const approve = useCallback(async (s) => {
        const key = `${s.urn}#${s.field ?? ''}#${s.kind}#${s.value}`;
        try {
            if (s.kind === 'tag')
                await applyTag(s.urn, [s.value], s.field);
            else
                await applyDescription(s.urn, s.value, s.field);
            setApplied((prev) => new Set(prev).add(key));
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'write-back failed');
        }
    }, []);
    const persist = useCallback(async () => {
        if (!graph)
            return;
        try {
            const scene = render(graph, ann?.keep);
            const res = await saveDiagram(graph, scene, `${seed?.name ?? 'diagram'} — ${mode}`);
            setSaveNote(res.note ?? 'Saved to DataHub under Architecture Diagrams.');
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'save failed');
        }
    }, [graph, ann, seed, mode]);
    const busy = phase !== 'idle' && phase !== 'ready' && phase !== 'error';
    const stats = graph?.stats;
    const gapCount = useMemo(() => graph?.nodes.reduce((a, n) => a + n.gaps.length, 0) ?? 0, [graph]);
    return (<div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 280px',
            gap: 0,
            background: T.bg,
            color: T.text,
            border: `1px solid ${T.hairline}`,
            borderRadius: 10,
            overflow: 'hidden',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}>
      {/* ------------- controls ------------- */}
      <div style={{ padding: 20, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
            DataHub mode
          </h2>
          <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono }}>
            {graph ? `${graph.trace.length} calls · ${graph.trace.reduce((a, t) => a + t.ms, 0)}ms` : 'not connected'}
          </span>
        </div>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
          Diagrams are assembled from lineage, not described in prose. Pick the asset you care
          about.
        </p>

        {/* asset picker */}
        <label style={label}>Asset</label>
        {seed ? (<div style={{
                ...field,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
            }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {seed.name}
              </div>
              <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>
                {[seed.platform, seed.domain ?? 'no domain'].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button onClick={() => {
                setSeed(null);
                setQuery('');
                setGraph(null);
                setPhase('idle');
            }} style={ghostBtn}>
              Change
            </button>
          </div>) : (<>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Table, dashboard, or model name" style={field}/>
            {hits.length > 0 && (<ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, maxHeight: 190, overflowY: 'auto' }}>
                {hits.map((h) => (<li key={h.urn}>
                    <button onClick={() => {
                        setSeed(h);
                        setHits([]);
                    }} style={hitBtn}>
                      <span style={{ fontSize: 12 }}>{h.name}</span>
                      <span style={{ fontSize: 10, color: T.muted, fontFamily: T.mono }}>
                        {[h.platform, h.type.toLowerCase(), h.ownerCount ? `${h.ownerCount} owners` : 'unowned']
                        .filter(Boolean)
                        .join(' · ')}
                      </span>
                    </button>
                  </li>))}
              </ul>)}
          </>)}

        {/* modes */}
        <label style={{ ...label, marginTop: 18 }}>View</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.keys(MODES).map((m) => (<button key={m} onClick={() => setMode(m)} style={{
                ...chip,
                borderColor: mode === m ? T.ember : T.hairline,
                color: mode === m ? T.text : T.muted,
                background: mode === m ? 'rgba(175,52,51,0.12)' : 'transparent',
            }}>
              {MODES[m].label}
            </button>))}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
          {MODES[mode].blurb}
        </p>

        {/* traversal controls */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', marginTop: 18 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>
              Hop limit <span style={{ fontFamily: T.mono, color: T.text }}>{hops}</span>
            </label>
            <input type="range" min={1} max={4} value={hops} onChange={(e) => setHops(Number(e.target.value))} style={{ width: '100%', accentColor: T.ember }}/>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: T.muted }}>
            <input type="checkbox" checked={excludeStaging} onChange={(e) => setExcludeStaging(e.target.checked)} style={{ accentColor: T.ember }}/>
            Collapse staging
          </label>
        </div>

        {/* refinement */}
        <label style={{ ...label, marginTop: 18 }}>Refine (optional)</label>
        <input value={refine} onChange={(e) => setRefine(e.target.value)} placeholder="Only the path to revenue dashboards" style={field}/>
        <p style={{ margin: '6px 0 0', fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
          Refinement filters the graph after it is built. It cannot add assets that do not exist in
          DataHub.
        </p>

        <button onClick={generate} disabled={!seed || busy} style={{ ...primaryBtn, marginTop: 18 }}>
          {busy ? PHASE_COPY[phase] : 'Generate canvas'}
        </button>

        {error && (<div style={errorBox}>
            <strong style={{ fontWeight: 600 }}>{error}</strong>
            <div style={{ marginTop: 6, color: T.muted }}>
              Check DATAHUB_MCP_URL or DATAHUB_GMS_URL and that the token has read access to this
              asset.
            </div>
          </div>)}

        {/* results summary */}
        {stats && (<div style={{ marginTop: 20, borderTop: `1px solid ${T.hairline}`, paddingTop: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <Stat label="rendered" value={`${stats.nodesRendered}/${stats.nodesDiscovered}`}/>
              <Stat label="pruned" value={String(stats.prunedForNoise)}/>
              <Stat label="edges" value={String(stats.edgesRendered)}/>
              <Stat label="metadata gaps" value={String(gapCount)} tone={gapCount ? T.warn : T.good}/>
            </div>
            {ann?.dropReason && (<p style={{ margin: '12px 0 0', fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
                Refinement: {ann.dropReason}
              </p>)}
            {ann && ann.validation.rejectedForHallucination > 0 && (<p style={{ margin: '6px 0 0', fontSize: 11, color: T.warn }}>
                Dropped {ann.validation.rejectedForHallucination} model-invented reference before
                rendering.
              </p>)}

            <button onClick={persist} style={{ ...ghostBtn, marginTop: 14, width: '100%' }}>
              Save this diagram to DataHub
            </button>
            {saveNote && (<p style={{ margin: '8px 0 0', fontSize: 11, color: T.good }}>{saveNote}</p>)}
          </div>)}

        {/* suggestions */}
        {ann?.suggestions.length ? (<div style={{ marginTop: 20, borderTop: `1px solid ${T.hairline}`, paddingTop: 16 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600 }}>
              Fill the gaps ({ann.suggestions.length})
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
              Proposed from the graph. Approving writes to DataHub.
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {ann.suggestions.map((s) => {
                const key = `${s.urn}#${s.field ?? ''}#${s.kind}#${s.value}`;
                const done = applied.has(key);
                return (<li key={key} style={suggestionCard}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, marginBottom: 3 }}>
                        {s.kind} · {s.field ?? s.urn.split(',')[1] ?? s.urn}
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.45 }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>{s.rationale}</div>
                    </div>
                    <button onClick={() => approve(s)} disabled={done} style={ghostBtn}>
                      {done ? 'Written' : 'Approve'}
                    </button>
                  </li>);
            })}
            </ul>
          </div>) : null}
      </div>

      {/* ------------- trace rail ------------- */}
      <TraceRail phase={phase} trace={graph?.trace ?? []} summary={graph ? summarize(graph) : null}/>
    </div>);
}
/* ---------------- trace rail ---------------- */
function TraceRail({ phase, trace, summary, }) {
    return (<aside style={{
            borderLeft: `1px solid ${T.hairline}`,
            background: T.raised,
            padding: '20px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            minWidth: 0,
        }}>
      <div>
        <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.muted }}>
          Agent trace
        </div>
        <div style={{ fontSize: 12, marginTop: 4, color: phase === 'error' ? T.ember : T.text }}>
          {PHASE_COPY[phase]}
        </div>
      </div>

      {trace.length === 0 ? (<p style={{ fontSize: 11, color: T.muted, lineHeight: 1.6, margin: 0 }}>
          Every DataHub call this canvas depends on appears here, in order, with timings. Nothing on
          the canvas comes from anywhere else.
        </p>) : (<ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 0, overflowY: 'auto' }}>
          {trace.map((t, i) => (<li key={`${t.tool}-${i}`} style={{
                    position: 'relative',
                    paddingLeft: 16,
                    paddingBottom: 12,
                    borderLeft: `1px solid ${i === trace.length - 1 ? 'transparent' : T.hairline}`,
                    marginLeft: 3,
                }}>
              <span style={{
                    position: 'absolute',
                    left: -4,
                    top: 4,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: t.ok ? T.good : T.ember,
                }}/>
              <div style={{ fontSize: 11, fontFamily: T.mono, color: T.text }}>{t.tool}</div>
              <div style={{ fontSize: 10, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>
                {t.resultSummary} · {t.ms}ms
              </div>
            </li>))}
        </ol>)}

      {summary && (<div style={{ borderTop: `1px solid ${T.hairline}`, paddingTop: 12, marginTop: 'auto' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.muted }}>
            What the agent found
          </div>
          <p style={{ fontSize: 11, color: T.text, lineHeight: 1.6, margin: '6px 0 0', whiteSpace: 'pre-line' }}>
            {summary}
          </p>
        </div>)}
    </aside>);
}
function Stat({ label, value, tone }) {
    return (<div>
      <div style={{ fontSize: 15, fontFamily: T.mono, color: tone ?? T.text }}>{value}</div>
      <div style={{ fontSize: 10, color: T.muted, letterSpacing: '0.04em' }}>{label}</div>
    </div>);
}
/* ---------------- styles ---------------- */
const label = {
    display: 'block',
    fontSize: 10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: T.muted,
    marginBottom: 6,
};
const field = {
    width: '100%',
    boxSizing: 'border-box',
    background: T.raised,
    border: `1px solid ${T.hairline}`,
    borderRadius: 6,
    color: T.text,
    fontSize: 13,
    padding: '9px 11px',
    outline: 'none',
};
const primaryBtn = {
    width: '100%',
    background: T.ember,
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    padding: '11px 14px',
    cursor: 'pointer',
};
const ghostBtn = {
    background: 'transparent',
    border: `1px solid ${T.hairline}`,
    borderRadius: 6,
    color: T.text,
    fontSize: 11,
    padding: '7px 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
};
const chip = {
    border: `1px solid ${T.hairline}`,
    borderRadius: 6,
    background: 'transparent',
    fontSize: 12,
    padding: '7px 11px',
    cursor: 'pointer',
};
const hitBtn = {
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${T.hairline}`,
    color: T.text,
    padding: '8px 2px',
    cursor: 'pointer',
    display: 'grid',
    gap: 2,
};
const errorBox = {
    marginTop: 14,
    border: `1px solid ${T.ember}`,
    background: 'rgba(175,52,51,0.08)',
    borderRadius: 6,
    padding: '10px 12px',
    fontSize: 12,
    lineHeight: 1.5,
};
const suggestionCard = {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    border: `1px solid ${T.hairline}`,
    borderRadius: 6,
    padding: '10px 11px',
    background: T.raised,
};
