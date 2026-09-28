import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SettingsProvider } from './state/SettingsProvider';
import { useEngineStore } from './state/engineStore';
import './index.css';
import './i18n';

// The engine loads BEHIND the app, not in front of it.
//
// Mounting used to wait on initEngine() in a `.finally()`, which quietly made
// every way a 2.3 MB download can go wrong a way the entire UI can fail to
// appear. A fetch that stalls rather than fails never settles, so `.finally()`
// never ran and the boot splash stayed up with no app, no message and no way
// out but a reload. Falling back to the JS engine is no answer either: that is
// a 1 MB chunk fetched over the same connection.
//
// Nothing below the kernel is needed to draw a rocket. The component tree, the
// schematic, the design library and the .ork/.rkt paths are all plain TypeScript;
// only the static numbers and the simulations need the engine, and they wait for
// it on their own (state/engineStore.ts, and the rebuild effect in
// useWorkspaceEffects).
useEngineStore.getState().start();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </React.StrictMode>,
);
