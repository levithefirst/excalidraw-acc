// lib/avatars.js
// no uploads, no storage. a handle in, a base64 dataURL out.
// unavatar.io resolves x/github/etc profile pictures for free.

function fileIdFor(handle) {
  let h = 0;
  for (const c of handle) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `av-${h.toString(36)}-${handle.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
}

export async function fetchAvatars(handles) {
  const map = new Map();
  await Promise.all(
    handles.map(async (handle) => {
      const clean = handle.replace(/^@/, "").trim();
      if (!clean) return;
      try {
        const res = await fetch(`https://unavatar.io/x/${encodeURIComponent(clean)}?fallback=false`, {
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return;
        const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/png";
        if (!mimeType.startsWith("image/")) return;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 400_000) return; // keep the file lean
        map.set(handle, {
          fileId: fileIdFor(clean),
          mimeType,
          dataURL: `data:${mimeType};base64,${buf.toString("base64")}`,
        });
      } catch {
        // a missing avatar never kills a diagram
      }
    })
  );
  return map;
}
