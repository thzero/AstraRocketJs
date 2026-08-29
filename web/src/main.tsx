import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SettingsProvider } from './state/SettingsProvider';
import { initEngine } from './engine/openRocketEngine';
import './index.css';
import './i18n';

// Pick the engine backend (WASM-GC when the browser supports it, faster; else the
// JS build) before mounting, so the first design/sim runs on the chosen backend.
// Never blocks the app: initEngine resolves to the JS default on any failure, and
// we render in .finally() regardless.
initEngine()
  .then((backend) => console.info(`[engine] backend: ${backend}`))
  .catch(() => { /* JS fallback already active */ })
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </React.StrictMode>,
    );
  });
