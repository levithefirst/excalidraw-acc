// lib/layout.js
// all geometry lives here. the model never sees a coordinate.
// v2: label-aware sizing, multi-ring hub for dense diagrams,
// and a deterministic post-placement overlap resolution pass.

const GAP_X = 120;
const GAP_Y = 110;
const CHAR_W = 11; // approx virgil char width at fontSize 20
const SUB_CHAR_W = 9;

function sizeFor(node) {
  const labelW = node.label.length * CHAR_W + 64;
  const subW = node.sublabel ? node.sublabel.length * SUB_CHAR_W + 64 : 0;
  const w = Math.max(180, Math.min(360, Math.max(labelW, subW)));
  const h = node.sublabel ? 116 : 90;
  // diamonds need extra room: text sits in the inscribed box
  if (node.shape === "diamond") return { w: w * 1.35, h: h * 1.3 };
  return { w, h };
}

// flow: layered top-down. depth = longest path from any root.
function layoutFlow(nodes, edges) {
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) out.get(e.from).push(e.to);

  const order = [...nodes.map((n) => n.id)];
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const id of order) {
      for (const t of out.get(id)) {
        if (depth.get(t) < depth.get(id) + 1 && depth.get(id) + 1 < nodes.length) {
          depth.set(t, depth.get(id) + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const rows = new Map();
  for (const n of nodes) {
    const d = depth.get(n.id);
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d).push(n);
  }

  const placed = new Map();
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);
  let y = 0;
  for (const d of rowKeys) {
    const row = rows.get(d);
    const sizes = row.map(sizeFor);
    const totalW = sizes.reduce((s, x) => s + x.w, 0) + GAP_X * (row.length - 1);
    let x = -totalW / 2;
    let rowH = 0;
    row.forEach((n, i) => {
      placed.set(n.id, { x, y, w: sizes[i].w, h: sizes[i].h, colorIndex: d });
      x += sizes[i].w + GAP_X;
      rowH = Math.max(rowH, sizes[i].h);
    });
    // rows with avatars need headroom for the chip above the node
    const hasAvatar = row.some((n) => n.avatar);
    y += rowH + GAP_Y + (hasAvatar ? 40 : 0);
  }
  return placed;
}

// hub: first node center. up to 6 spokes on ring 1, the rest on ring 2.
// radius scales with both spoke count and the widest label on the ring.
function layoutHub(nodes) {
  const placed = new Map();
  const center = nodes[0];
  const spokes = nodes.slice(1);
  const cs = sizeFor(center);
  placed.set(center.id, { x: -cs.w / 2, y: -cs.h / 2, w: cs.w, h: cs.h, colorIndex: 0 });

  const ring1 = spokes.slice(0, 6);
  const ring2 = spokes.slice(6);

  const placeRing = (ring, ringIndex, startAngle) => {
    if (!ring.length) return;
    const sizes = ring.map(sizeFor);
    const widest = Math.max(...sizes.map((s) => s.w));
    const radius = Math.max(300 + ringIndex * 230, ring.length * 58 + widest * 0.55 + ringIndex * 200);
    ring.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / ring.length + startAngle;
      const s = sizes[i];
      placed.set(n.id, {
        x: Math.cos(angle) * radius - s.w / 2,
        y: Math.sin(angle) * radius - s.h / 2,
        w: s.w,
        h: s.h,
        colorIndex: (ringIndex === 0 ? i : i + ring1.length) + 1,
      });
    });
  };

  placeRing(ring1, 0, -Math.PI / 2);
  placeRing(ring2, 1, -Math.PI / 2 + Math.PI / (ring2.length || 1)); // offset ring 2 between ring 1 spokes
  return placed;
}

// deterministic post-placement pass: if two boxes overlap (with margin),
// push them apart along the axis needing least movement. few iterations,
// capped movement, O(n^2) over <=12 nodes -- instant everywhere.
function resolveOverlaps(placed) {
  const MARGIN = 28;
  const ids = [...placed.keys()];
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = placed.get(ids[i]);
        const b = placed.get(ids[j]);
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + MARGIN;
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + MARGIN;
        if (overlapX > 0 && overlapY > 0) {
          const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
          const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
          if (overlapX < overlapY) {
            const push = Math.min(overlapX / 2 + 6, 60);
            if (acx <= bcx) { a.x -= push; b.x += push; } else { a.x += push; b.x -= push; }
          } else {
            const push = Math.min(overlapY / 2 + 6, 60);
            if (acy <= bcy) { a.y -= push; b.y += push; } else { a.y += push; b.y -= push; }
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return placed;
}

export function layoutSpec(spec) {
  const placed = spec.layout === "hub" ? layoutHub(spec.nodes) : layoutFlow(spec.nodes, spec.edges);
  return resolveOverlaps(placed);
}
