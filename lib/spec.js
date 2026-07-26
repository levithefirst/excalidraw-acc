// lib/spec.js
// claude produces ONLY this small intermediate spec. it never touches
// coordinates, ids, or excalidraw schema. code owns all geometry.

export function buildPrompt(content, maxColors, handles) {
  const handleNote = handles.length
    ? `\nAVATAR HANDLES PROVIDED BY USER: ${handles.join(", ")}\nAssign each handle to the single node it most clearly represents (a person, project, protocol, or brand). Use the "avatar" field. Never invent handles that were not provided. It is fine to leave handles unassigned if nothing matches.`
    : "";

  return `You convert content into a diagram plan. Respond with ONLY a JSON object, no markdown fences, no commentary.

SCHEMA (all fields shown; optional fields may be omitted):
{
  "title": "short diagram title, max 6 words",
  "takeaway": "one-line distilled insight from the content, max 12 words",
  "layout": "flow" | "hub",
  "nodes": [
    { "id": "slug", "label": "max 5 words", "sublabel": "optional, max 8 words", "shape": "rectangle" | "ellipse" | "diamond", "emphasis": true, "avatar": "handle" }
  ],
  "edges": [
    { "from": "node-id", "to": "node-id", "label": "optional, max 4 words" }
  ]
}

RULES:
- "flow" for processes, sequences, how-things-work. "hub" for ecosystems, one central concept with related parts.
- 4 to 10 nodes. Fewer, clearer nodes beat many vague ones.
- ids are lowercase slugs (a-z, 0-9, hyphens). Every edge references existing node ids.
- "diamond" only for decisions/questions. "ellipse" for start/end points or people. "rectangle" for everything else.
- "emphasis": true on at most 2 nodes that deserve visual weight.
- In "flow" layout, edges must form a mostly forward-moving structure (no dense webs).
- In "hub" layout, the first node in the array is the center; most edges connect the center to spokes.
- The diagram will use at most ${maxColors} colors. You do not pick colors. Do not mention colors.${handleNote}

CONTENT TO DIAGRAM:
${content}`;
}

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);

// strips markdown fences if the model added them anyway, then parses
export function parseSpec(raw) {
  let text = String(raw).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object found");
  return JSON.parse(text.slice(start, end + 1));
}

// validates + silently repairs everything repairable. throws only when
// the spec is beyond saving (that triggers the single retry upstream).
export function validateSpec(spec, handles) {
  if (!spec || typeof spec !== "object") throw new Error("spec is not an object");
  if (!Array.isArray(spec.nodes) || spec.nodes.length < 2) throw new Error("need at least 2 nodes");

  const layout = spec.layout === "hub" ? "hub" : "flow";
  const title = typeof spec.title === "string" && spec.title.trim() ? spec.title.trim().slice(0, 60) : "untitled diagram";
  const takeaway = typeof spec.takeaway === "string" && spec.takeaway.trim() ? spec.takeaway.trim().slice(0, 90) : null;

  const seen = new Set();
  const nodes = [];
  for (const n of spec.nodes.slice(0, 12)) {
    if (!n || typeof n !== "object") continue;
    let id = String(n.id || n.label || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id) continue;
    while (seen.has(id)) id += "-x";
    seen.add(id);
    const label = String(n.label || id).trim().slice(0, 48);
    const avatar = typeof n.avatar === "string" && handles.includes(n.avatar) ? n.avatar : null;
    nodes.push({
      id,
      label,
      sublabel: typeof n.sublabel === "string" ? n.sublabel.trim().slice(0, 64) : null,
      shape: SHAPES.has(n.shape) ? n.shape : "rectangle",
      emphasis: n.emphasis === true,
      avatar,
    });
  }
  if (nodes.length < 2) throw new Error("fewer than 2 valid nodes after repair");

  const ids = new Set(nodes.map((n) => n.id));
  const edges = [];
  const edgeSeen = new Set();
  for (const e of Array.isArray(spec.edges) ? spec.edges : []) {
    if (!e || typeof e !== "object") continue;
    const from = String(e.from || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const to = String(e.to || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    const key = `${from}->${to}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    edges.push({ from, to, label: typeof e.label === "string" ? e.label.trim().slice(0, 32) : null });
  }

  return { title, takeaway, layout, nodes, edges };
}
