// lib/examples.js
// hardcoded specs for instant demos. clicking an example chip builds
// the file straight from these — no claude call, no api credits burned.

export const EXAMPLES = {
  "zk-rollup": {
    label: "zk rollup, explained",
    style: "sketch",
    maxColors: 3,
    spec: {
      title: "how a zk rollup works",
      takeaway: "thousands of transactions, one proof, one cheap settlement",
      layout: "flow",
      nodes: [
        { id: "users", label: "users transact", shape: "ellipse" },
        { id: "sequencer", label: "sequencer", sublabel: "orders + batches transactions", shape: "rectangle", emphasis: true },
        { id: "prover", label: "prover", sublabel: "generates validity proof", shape: "rectangle" },
        { id: "proof", label: "one zk proof", sublabel: "covers the whole batch", shape: "rectangle", emphasis: true },
        { id: "l1", label: "ethereum verifies", shape: "diamond" },
        { id: "final", label: "finality", sublabel: "state settled on L1", shape: "ellipse" },
      ],
      edges: [
        { from: "users", to: "sequencer" },
        { from: "sequencer", to: "prover" },
        { from: "prover", to: "proof" },
        { from: "proof", to: "l1", label: "submit" },
        { from: "l1", to: "final", label: "valid" },
      ],
    },
  },
  "dao-gov": {
    label: "dao governance map",
    style: "sketch",
    maxColors: 4,
    spec: {
      title: "dao governance, mapped",
      takeaway: "every arrow is a power flow. follow them before you vote",
      layout: "hub",
      nodes: [
        { id: "dao", label: "the dao", sublabel: "treasury + rules", shape: "ellipse", emphasis: true },
        { id: "holders", label: "token holders", shape: "rectangle" },
        { id: "delegates", label: "delegates", shape: "rectangle" },
        { id: "proposals", label: "proposals", shape: "rectangle" },
        { id: "timelock", label: "timelock", sublabel: "delay before execution", shape: "diamond" },
        { id: "treasury", label: "treasury", shape: "rectangle" },
        { id: "forum", label: "forum debate", shape: "rectangle" },
      ],
      edges: [
        { from: "holders", to: "dao", label: "vote" },
        { from: "holders", to: "delegates", label: "delegate" },
        { from: "delegates", to: "dao", label: "vote" },
        { from: "forum", to: "proposals" },
        { from: "proposals", to: "dao" },
        { from: "dao", to: "timelock" },
        { from: "timelock", to: "treasury", label: "execute" },
      ],
    },
  },
  "how-it-works": {
    label: "how sketchdrop works",
    style: "clean",
    maxColors: 3,
    spec: {
      title: "how sketchdrop works",
      takeaway: "ai drafts the structure. deterministic code draws the geometry",
      layout: "flow",
      nodes: [
        { id: "content", label: "your content", shape: "ellipse" },
        { id: "claude", label: "claude", sublabel: "drafts nodes + edges only", shape: "rectangle", emphasis: true },
        { id: "code", label: "deterministic code", sublabel: "geometry, palette, file assembly", shape: "rectangle", emphasis: true },
        { id: "valid", label: "valid file?", shape: "diamond" },
        { id: "file", label: ".excalidraw file", sublabel: "yours to keep editing", shape: "ellipse" },
      ],
      edges: [
        { from: "content", to: "claude" },
        { from: "claude", to: "code" },
        { from: "code", to: "valid" },
        { from: "valid", to: "file", label: "download" },
      ],
    },
  },
};
