import React from "react";
import { createRoot } from "react-dom/client";
import "./top-menu/top-menu.css";
import "./shell.css";
import Shell from "./Shell.jsx";

// The server-rendered page has <div id="top-menu-root"> inside its shell bar; this fills it.
createRoot(document.getElementById("top-menu-root")).render(<Shell />);
