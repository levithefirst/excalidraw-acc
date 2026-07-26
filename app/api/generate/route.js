// app/api/generate/route.js
import { buildPrompt, parseSpec, validateSpec } from "../../../lib/spec.js";
import { buildExcalidraw, validateFile } from "../../../lib/excalidraw.js";
import { fetchAvatars } from "../../../lib/avatars.js";
import { EXAMPLES } from "../../../lib/examples.js";

export const maxDuration = 60;

const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 10);

// simple per-instance rate limit. good enough for a hackathon window.
const usage = new Map();
function allow(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const rec = usage.get(ip);
  if (!rec || rec.day !== day) {
    usage.set(ip, { day, count: 1 });
    return true;
  }
  if (rec.count >= DAILY_LIMIT) return false;
  rec.count += 1;
  return true;
}

async function callClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`claude api ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function fileResponse(doc, title) {
  const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "diagram";
  return new Response(JSON.stringify(doc), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${filename}.excalidraw"`,
    },
  });
}

export async function POST(req) {
  try {
    const body = await req.json();

    // example chips: build straight from a canned spec. zero api cost,
    // no rate limit, instant. this path never touches claude.
    if (body.example && EXAMPLES[body.example]) {
      const ex = EXAMPLES[body.example];
      const spec = validateSpec(ex.spec, []);
      const doc = buildExcalidraw(spec, ex.maxColors, new Map(), ex.style);
      const errors = validateFile(doc);
      if (errors.length) return Response.json({ error: `internal validation failed: ${errors[0]}` }, { status: 500 });
      return fileResponse(doc, spec.title);
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: "server missing ANTHROPIC_API_KEY" }, { status: 500 });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!allow(ip)) {
      return Response.json({ error: "sketchbook's full for today. the examples below still work — or come back tomorrow." }, { status: 429 });
    }

    const content = String(body.content || "").trim().slice(0, 8000);
    const maxColors = Math.min(5, Math.max(2, Number(body.maxColors) || 3));
    const style = body.style === "clean" ? "clean" : "sketch";
    const handles = (Array.isArray(body.handles) ? body.handles : [])
      .map((h) => String(h).replace(/^@/, "").trim())
      .filter(Boolean)
      .slice(0, 6);

    if (content.length < 20) {
      return Response.json({ error: "give me a bit more content to work with — i need at least a couple of sentences." }, { status: 400 });
    }

    const prompt = buildPrompt(content, maxColors, handles);
    const avatarsPromise = fetchAvatars(handles);

    // first attempt + one targeted repair retry — never more
    let spec;
    try {
      spec = validateSpec(parseSpec(await callClaude(prompt)), handles);
    } catch (firstError) {
      const retryPrompt = `${prompt}\n\nYour previous attempt failed validation with: "${firstError.message}". Respond again with ONLY a corrected JSON object following the schema exactly.`;
      spec = validateSpec(parseSpec(await callClaude(retryPrompt)), handles);
    }

    const avatarFiles = await avatarsPromise;
    const doc = buildExcalidraw(spec, maxColors, avatarFiles, style);

    const errors = validateFile(doc);
    if (errors.length) {
      return Response.json({ error: `internal validation failed: ${errors[0]}` }, { status: 500 });
    }

    return fileResponse(doc, spec.title);
  } catch (err) {
    return Response.json({ error: err.message || "generation failed" }, { status: 500 });
  }
}
