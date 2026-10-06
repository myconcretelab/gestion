import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import "./appearance.css";
import { APPEARANCE_KEY, applyAppearance, readAppearance } from "./utils/appearance";

applyAppearance(readAppearance());
window.addEventListener("storage", event => {
  if (event.key === APPEARANCE_KEY || event.key === null) applyAppearance(readAppearance());
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
