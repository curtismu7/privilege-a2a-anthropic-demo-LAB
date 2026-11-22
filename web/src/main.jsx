import React from "react";
import { createRoot } from "react-dom/client";
import "./top-menu/top-menu.css";
import "./components/JsonPane.css";
import "./shell.css";
import Shell from "./Shell.jsx";
import RunObs from "./RunObs.jsx";

// The server-rendered page has <div id="top-menu-root"> inside its shell bar; this fills it.
createRoot(document.getElementById("top-menu-root")).render(<Shell />);
// Rule 27: the run-observability panel under the Run (the page script announces runs with paad:run-done).
const obsRoot = document.getElementById("run-obs-root");
if (obsRoot) createRoot(obsRoot).render(<RunObs />);
