// =============================================================================
// File:    main.tsx
// Project: Smart Object Foundations — MDes Prototyping, CCA
// Demo:    AI Studio — Heartbeat Detection + Stress Analysis
//
// Authors: Copilot
//          Thomas J McLeish
// License: MIT — see LICENSE in the root of this repository
// =============================================================================
//
// React entry point. Mounts the root <App /> component inside React StrictMode,
// which activates additional runtime checks and warnings during development.

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
