// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

// ⬇️ Auth context (JS version from Phase 1)
import { AuthProvider } from "./context/AuthContext.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* Provide auth state to the whole app */}
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>

      {/* Invisible reCAPTCHA target for Phone auth (must be in the DOM) */}
      <div id="recaptcha-container" style={{ display: "none" }} />
    </AuthProvider>
  </React.StrictMode>
);