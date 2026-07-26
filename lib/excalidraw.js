// lib/excalidraw.js
// deterministic assembly of a valid .excalidraw file from a validated
// spec + layout. palette + style enforcement happens here, never in the model.

import { layoutSpec } from "./layout.js";

const INK = "#1e1e1e";
const ACCENTS = ["#cc2222", "#1971c2", "#2f9e44", "#f08c00"]; // ember red first, then blue/green/orange
const WATERMARK = "made with sketchdrop"; // set to "" to disable

// two output styles, mapped to native excalidraw properties.
// sketch: hand-drawn virgil energy. clean: crisp technical look.
const STYLES = {
  sketch: { roughness: 1, fontFamily: 1, strokeWidth: 2 },
  clean: { roughness: 0, fontFamily: 2, strokeWidth: 1.5 },
};

function buildPalette(maxColors) {
  const n = Math.min(5, Math.max(2, maxColors));
  return [INK, ...ACCENTS.slice(0, n - 1)];
}

let counter = 0;
let styleCfg = STYLES.sketch;

function id() {
  counter += 1;
  return `sd-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function rand() {
  return Math.floor(Math.random() * 2 ** 31);
}

function base(type, x, y, w, h, stroke) {
  return {
    id: id(),
    type,
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: stroke,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: styleCfg.strokeWidth,
    strokeStyle: "solid",
    roughness: styleCfg.roughness,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === "rectangle" ? { type: 3 } : null,
    seed: rand(),
    version: 1,
    versionNonce: rand(),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

function textElement(text, x, y, w, opts = {}) {
  const fontSize = opts.fontSize || 20;
  const lineHeight = 1.25;
  const lines = text.split("\n").length;
  const el = {
    ...base("text", x, y, w, fontSize * lineHeight * lines, opts.color || INK),
    text,
    originalText: text,
    fontSize,
    fontFamily: styleCfg.fontFamily,
    textAlign: opts.align || "center",
    verticalAlign: opts.container ? "middle" : "top",
    containerId: opts.container || null,
    autoResize: true,
    lineHeight,
  };
  el.roundness = null;
  el.boundElements = null;
  return el;
}

function boundLabel(container, text) {
  const t = textElement(text, container.x + 10, container.y + container.height / 2 - 12, container.width - 20, {
    container: container.id,
  });
  t.strokeColor = INK; // text always ink: keeps color budget honest and readable
  container.boundElements.push({ id: t.id, type: "text" });
  return t;
}

function arrowBetween(a, b, stroke, label) {
  const acx = a.x + a.width / 2, acy = a.y + a.height / 2;
  const bcx = b.x + b.width / 2, bcy = b.y + b.height / 2;
  const dx = bcx - acx, dy = bcy - acy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const startPad = Math.min(a.width, a.height) / 2 + 6;
  const endPad = Math.min(b.width, b.height) / 2 + 14;
  const sx = acx + ux * startPad, sy = acy + uy * startPad;
  const ex = bcx - ux * endPad, ey = bcy - uy * endPad;

  const arrow = {
    ...base("arrow", sx, sy, ex - sx, ey - sy, stroke),
    points: [
      [0, 0],
      [ex - sx, ey - sy],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: a.id, focus: 0, gap: 6 },
    endBinding: { elementId: b.id, focus: 0, gap: 6 },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };
  arrow.roundness = { type: 2 };
  a.boundElements.push({ id: arrow.id, type: "arrow" });
  b.boundElements.push({ id: arrow.id, type: "arrow" });

  const extras = [];
  if (label) {
    const t = textElement(label, (sx + ex) / 2 - 40, (sy + ey) / 2 - 24, 80, { fontSize: 16 });
    extras.push(t);
  }
  return [arrow, ...extras];
}

function imageElement(fileId, x, y, size) {
  const el = {
    ...base("image", x, y, size, size, "transparent"),
    fileId,
    status: "saved",
    scale: [1, 1],
  };
  el.roundness = null;
  return el;
}

// avatar chip: real image when fetched, initials in a palette ring when not.
// nodes with an assigned handle never look broken.
function avatarChip(node, p, stroke, avatarFiles, files, elements) {
  const size = 56;
  const cx = p.x + p.w / 2;
  const top = p.y - size + 14;

  if (avatarFiles.has(node.avatar)) {
    const f = avatarFiles.get(node.avatar);
    // ring behind the image so the chip reads as intentional, not floating
    const ring = base("ellipse", cx - size / 2 - 4, top - 4, size + 8, size + 8, stroke);
    ring.backgroundColor = "#ffffff";
    ring.fillStyle = "solid";
    elements.push(ring);
    elements.push(imageElement(f.fileId, cx - size / 2, top, size));
    files[f.fileId] = {
      mimeType: f.mimeType,
      id: f.fileId,
      dataURL: f.dataURL,
      created: Date.now(),
      lastRetrieved: Date.now(),
    };
  } else {
    // initials fallback
    const ring = base("ellipse", cx - size / 2, top, size, size, stroke);
    ring.backgroundColor = "#ffffff";
    ring.fillStyle = "solid";
    elements.push(ring);
    const initials = node.avatar.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
    elements.push(boundLabel(ring, initials));
  }
}

/**
 * spec: validated spec from spec.js
 * maxColors: 2-5
 * avatarFiles: Map(handle -> { fileId, mimeType, dataURL }) — may be empty
 * style: "sketch" | "clean"
 */
export function buildExcalidraw(spec, maxColors, avatarFiles, style = "sketch") {
  counter = 0;
  styleCfg = STYLES[style] || STYLES.sketch;
  const palette = buildPalette(maxColors);
  const placed = layoutSpec(spec);
  const elements = [];
  const files = {};
  const nodeEls = new Map();

  const bounds = [...placed.values()];
  const minX = Math.min(...bounds.map((p) => p.x));
  const minY = Math.min(...bounds.map((p) => p.y));
  const maxX = Math.max(...bounds.map((p) => p.x + p.w));
  const maxY = Math.max(...bounds.map((p) => p.y + p.h));

  // poster header: title + one-line takeaway, so the file reads authored
  const headerY = minY - (spec.takeaway ? 130 : 95);
  elements.push(textElement(spec.title, minX, headerY, maxX - minX, { fontSize: 28, align: "left" }));
  if (spec.takeaway) {
    const sub = textElement(spec.takeaway, minX, headerY + 44, maxX - minX, { fontSize: 16, align: "left" });
    sub.strokeColor = "#868e96";
    elements.push(sub);
  }

  // nodes
  for (const node of spec.nodes) {
    const p = placed.get(node.id);
    const stroke = palette[p.colorIndex % palette.length];
    const el = base(node.shape, p.x, p.y, p.w, p.h, stroke);
    if (node.emphasis) el.strokeWidth = styleCfg.strokeWidth + 1.5;
    elements.push(el);
    nodeEls.set(node.id, el);
    const labelText = node.sublabel ? `${node.label}\n${node.sublabel}` : node.label;
    elements.push(boundLabel(el, labelText));
    if (node.avatar) avatarChip(node, p, stroke, avatarFiles, files, elements);
  }

  // edges (color follows the source node so the budget holds)
  for (const e of spec.edges) {
    const a = nodeEls.get(e.from);
    const b = nodeEls.get(e.to);
    if (!a || !b) continue;
    elements.push(...arrowBetween(a, b, a.strokeColor, e.label));
  }

  // watermark
  if (WATERMARK) {
    const wm = textElement(WATERMARK, minX, maxY + 70, 240, { fontSize: 14, align: "left" });
    wm.strokeColor = "#868e96";
    wm.opacity = 60;
    elements.push(wm);
  }

  return {
    type: "excalidraw",
    version: 2,
    source: "https://sketchdrop.app",
    elements,
    appState: {
      gridSize: null,
      viewBackgroundColor: "#ffffff",
    },
    files,
  };
}

// cheap structural check before shipping the file to the user
export function validateFile(doc) {
  const errors = [];
  if (doc.type !== "excalidraw" || doc.version !== 2) errors.push("bad header");
  const ids = new Set(doc.elements.map((e) => e.id));
  if (ids.size !== doc.elements.length) errors.push("duplicate element ids");
  for (const el of doc.elements) {
    if (el.type === "image" && !doc.files[el.fileId]) errors.push(`image ${el.id} missing file entry`);
    if (el.type === "text" && el.containerId && !ids.has(el.containerId)) errors.push(`text ${el.id} orphan container`);
    if (el.type === "arrow") {
      if (el.startBinding && !ids.has(el.startBinding.elementId)) errors.push(`arrow ${el.id} bad startBinding`);
      if (el.endBinding && !ids.has(el.endBinding.elementId)) errors.push(`arrow ${el.id} bad endBinding`);
    }
    if (!Number.isFinite(el.x) || !Number.isFinite(el.y)) errors.push(`element ${el.id} bad coords`);
  }
  return errors;
}
