"use client";

import { useEffect, useRef, useState } from "react";
import Preview from "./components/Preview";

const EXAMPLES = [
  { id: "zk-rollup", label: "zk rollup, explained" },
  { id: "dao-gov", label: "dao governance map" },
  { id: "how-it-works", label: "how this tool works" },
];

const STAGES = ["reading your content…", "drafting the structure…", "drawing the geometry…", "packing your file…"];

export default function Home() {
  const [content, setContent] = useState("");
  const [maxColors, setMaxColors] = useState(3);
  const [style, setStyle] = useState("sketch");
  const [handles, setHandles] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState(null);
  const [filename, setFilename] = useState("");
  const stageTimer = useRef(null);

  useEffect(() => {
    if (busy) {
      setStage(0);
      stageTimer.current = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 900);
    } else if (stageTimer.current) {
      clearInterval(stageTimer.current);
    }
    return () => stageTimer.current && clearInterval(stageTimer.current);
  }, [busy]);

  async function generate(payload) {
    setBusy(true);
    setError("");
    setDoc(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `request failed (${res.status})`);
      }
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="(.+?)"/);
      setFilename(match ? match[1] : "diagram.excalidraw");
      setDoc(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function generateFromInput() {
    generate({
      content,
      maxColors,
      style,
      handles: handles.split(",").map((h) => h.trim()).filter(Boolean),
    });
  }

  function download() {
    const blob = new Blob([JSON.stringify(doc)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="wrap">
      <h1 className="brand">
        sketch<em>drop</em>
      </h1>
      <p className="tagline">
        paste anything. get a <strong>real .excalidraw file</strong> — editable on excalidraw.com, with your
        people in it and a color budget you control. not a screenshot.
      </p>

      <div className="card">
        <label htmlFor="content">
          your content <span className="hint">— a thread, an explainer, meeting notes, anything</span>
        </label>
        <textarea
          id="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="how a crypto wallet works: your wallet holds keys, not coins. when you send funds, it signs a transaction with your private key and broadcasts it to the network..."
        />
        <div className="chips" aria-label="instant examples">
          <span className="chips-label">or try one:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex.id} type="button" className="chip" disabled={busy} onClick={() => generate({ example: ex.id })}>
              {ex.label}
            </button>
          ))}
        </div>

        <div className="row">
          <div className="field">
            <label id="colors-label">
              color budget <span className="hint">— max colors</span>
            </label>
            <div className="seg" role="group" aria-labelledby="colors-label">
              {[2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-pressed={maxColors === n} onClick={() => setMaxColors(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label id="style-label">style</label>
            <div className="seg wide" role="group" aria-labelledby="style-label">
              <button type="button" aria-pressed={style === "sketch"} onClick={() => setStyle("sketch")}>
                sketch
              </button>
              <button type="button" aria-pressed={style === "clean"} onClick={() => setStyle("clean")}>
                clean
              </button>
            </div>
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="handles">
              avatars <span className="hint">— x handles, comma separated (optional)</span>
            </label>
            <input
              id="handles"
              type="text"
              value={handles}
              onChange={(e) => setHandles(e.target.value)}
              placeholder="levithefirst, anthropicai"
            />
          </div>
        </div>

        <button className="generate" onClick={generateFromInput} disabled={busy || content.trim().length < 20}>
          {busy ? STAGES[stage] : "generate .excalidraw"}
        </button>

        {error && <p className="status error">{error}</p>}
      </div>

      {doc && (
        <div className="result">
          <div className="result-head">
            <h2>here it is — editable, right now</h2>
            <button className="download" onClick={download}>
              download {filename}
            </button>
          </div>
          <Preview doc={doc} />
          <p className="result-foot">
            this canvas is live — move things, recolor, resize. the downloaded file opens the same way on{" "}
            <a href="https://excalidraw.com" target="_blank" rel="noreferrer">
              excalidraw.com
            </a>{" "}
            (just drag it onto the page), where you can also export png or svg.
          </p>
        </div>
      )}

      <p className="foot">
        ai drafts the structure. deterministic code draws the geometry. you own the file.
        <br />
        examples are free forever. custom generations are limited per day while in preview.
      </p>
    </main>
  );
}
