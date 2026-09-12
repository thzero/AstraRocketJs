import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SettingsProvider } from './state/SettingsProvider';
import { initEngine } from './engine/openRocketEngine';
import { showEngineStatus, showEngineFailed } from './bootSplash';
import './index.css';
import './i18n';

// Pick the engine backend (WASM-GC when the browser supports it, faster; else the
// JS build) before mounting, so the first design/sim runs on the chosen backend.
// Never blocks the app: initEngine resolves to the JS default on any failure, and
// we render in .finally() regardless.
//
// The status callback drives the boot splash in index.html — the engine is ~2.3 MB,
// which is a long, silent wait on a slow link without it. i18n is already
// initialised here: the import above is static, so it evaluates before this body.
initEngine(showEngineStatus)
  .then((backend) => console.info(`[engine] backend: ${backend}`))
  .catch(() => {
    showEngineFailed();
  })
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </React.StrictMode>,
    );
  });
