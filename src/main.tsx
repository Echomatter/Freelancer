import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./colors.css";
import "./available-usage.css";
import { applyTheme } from "../domain/theme.mjs";
// The local server has already supplied the saved palette before first paint.
applyTheme(document.documentElement.dataset.theme);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
