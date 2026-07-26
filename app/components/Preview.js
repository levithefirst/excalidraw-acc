"use client";

import dynamic from "next/dynamic";
import { Component } from "react";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(async () => (await import("@excalidraw/excalidraw")).Excalidraw, {
  ssr: false,
  loading: () => <p className="status">loading canvas…</p>,
});

// if the embedded canvas ever fails, the download flow is untouched.
class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return <p className="status">preview unavailable here — your downloaded file still opens fine on excalidraw.com.</p>;
    }
    return this.props.children;
  }
}

export default function Preview({ doc }) {
  if (!doc) return null;
  return (
    <Boundary>
      <div className="preview" aria-label="live editable preview of your diagram">
        <Excalidraw
          initialData={{
            elements: doc.elements,
            appState: { viewBackgroundColor: doc.appState?.viewBackgroundColor || "#ffffff", scrollToContent: true },
            files: doc.files,
            scrollToContent: true,
          }}
        />
      </div>
    </Boundary>
  );
}
