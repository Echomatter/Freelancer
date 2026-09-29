import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { RenderBoundary } from './RenderBoundary';
import { RemoteGate } from './RemoteGate';
import "./styles.css";
import "./colors.css";
import "./available-usage.css";
import { applyTheme } from "../domain/theme.mjs";
// The local server has already supplied the saved palette before first paint.
// Production HTML already carries validated custom tokens. Keep them until
// bootstrap provides the saved collection; static/dev pages use the fallback.
if (!document.documentElement.dataset.theme?.startsWith('custom-')) applyTheme(document.documentElement.dataset.theme);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RenderBoundary><RemoteGate><App /></RemoteGate></RenderBoundary>
  </React.StrictMode>,
);
