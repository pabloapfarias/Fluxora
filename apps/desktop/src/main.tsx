import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/globals.css";
import { createDesktopBridge } from "./services/desktopBridge";
import { ActiveProjectProvider } from "./contexts/ActiveProjectContext";

if (!window.fluxora) {
  (window as any).fluxora = createDesktopBridge();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ActiveProjectProvider>
        <App />
      </ActiveProjectProvider>
    </BrowserRouter>
  </React.StrictMode>
);
