import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const surface = document.body.dataset.surface === "tab" ? "tab" : "panel";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App surface={surface} />
  </React.StrictMode>,
);
