// =============================================================================
// File:    App.tsx
// Project: Smart Object Foundations — MDes Prototyping, CCA
// Demo:    AI Studio — Heartbeat Detection + Stress Analysis
//
// Authors: Copilot
//          Thomas J McLeish
// License: MIT — see LICENSE in the root of this repository
// =============================================================================
//
// Root React component. Owns all top-level UI state and persists reading
// history to localStorage (via storage.ts).
//
// LAYOUT OVERVIEW
// ---------------
//   <header>   — sticky nav bar: app name, connection status badge, history toggle
//   <main>
//     left (8 cols)  — <HeartbeatMonitor> canvas + Signal Confidence + Heart Rate cards
//     right (4 cols) — Stress Analysis panel + System Info + Biometric Insights
//   <footer>   — attribution line
//   <AnimatePresence> — history overlay (modal) shown when showHistory is true
//
// DATA FLOW
// ---------
//   HeartbeatMonitor detects a peak → calls onDataUpdate(bpm, confidence, stressScore)
//     → App updates signal state → re-renders stat cards
//     → App randomly persists (5 % chance per peak) via saveReading() → localStorage
//     → History list re-renders from the returned updated array

import React, { useState, useEffect } from 'react';
import { HeartbeatMonitor } from './components/HeartbeatMonitor';
import { Heart, Activity, Brain, History, Info, TrendingUp, ShieldCheck, Zap, Sun, Moon, Bluetooth, Usb, Sparkles, Cpu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HeartbeatReading, SignalState } from './types';
import { loadHistory, saveReading } from './storage';

type PanelInfoKey = 'stream' | 'confidence' | 'heartRate' | 'stress' | 'system' | 'insights';
type ThemeMode = 'dark' | 'light';
type ConnectionMode = 'serial' | 'bluetooth';

type ConnectionControls = {
  connectSerial: () => Promise<void>;
  connectBluetooth: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const PANEL_INFO: Record<PanelInfoKey, {
  title: string;
  summary: string;
  meaning: string;
  tip: string;
  caution: string;
}> = {
  stream: {
    title: 'Live Biometric Stream',
    summary: 'The graph displays each processing stage from raw input to derivative peaks in real time.',
    meaning: 'Use this panel first when troubleshooting. If Stage 0 is flat or noisy, downstream BPM and stress values will also be unstable.',
    tip: 'For clean traces, keep finger pressure steady and avoid moving the sensor cable during measurement.',
    caution: 'This visualization is a teaching aid and should not be interpreted as a clinical waveform.',
  },
  confidence: {
    title: 'Signal Confidence',
    summary: 'Confidence estimates beat detection reliability using rhythm consistency across recent intervals.',
    meaning: 'Higher percentages generally indicate stable sampling and accurate peak timing.',
    tip: 'If confidence is low, reconnect the sensor and hold still for 10–15 seconds before reading trends.',
    caution: 'High confidence does not guarantee medical-grade precision; it only reflects internal signal regularity.',
  },
  heartRate: {
    title: 'Heart Rate',
    summary: 'BPM is calculated from inter-beat intervals after removing implausible outlier timings.',
    meaning: 'Values near zero during startup usually mean the app has not yet captured enough valid peaks.',
    tip: 'Wait for confidence to stabilize before comparing BPM across activities or people.',
    caution: 'Short spikes can occur if the signal contains motion artifacts or double detections.',
  },
  stress: {
    title: 'Stress Analysis',
    summary: 'Stress score combines elevated BPM and rhythm variability into a 0–100 classroom index.',
    meaning: 'Use it to compare relative physiological arousal between moments, not as an absolute diagnosis.',
    tip: 'Track direction of change over time instead of focusing on a single instant value.',
    caution: 'This metric is educational and not intended for clinical stress assessment.',
  },
  system: {
    title: 'System Info',
    summary: 'This card lists current sampling and filtering settings used by the signal pipeline.',
    meaning: 'Sample rate and filter windows directly influence responsiveness, noise tolerance, and stability.',
    tip: 'If signals look too jittery, increase smoothing; if they lag, decrease smoothing window size.',
    caution: 'Changing filter parameters alters comparability with previously captured sessions.',
  },
  insights: {
    title: 'Biometric Insights',
    summary: 'Quick reference notes for interpreting BPM, confidence, and stress during demos.',
    meaning: 'These notes help non-technical audiences connect sensor behavior to body-state patterns.',
    tip: 'Pair this panel with live graph changes while asking participants to breathe slowly or move.',
    caution: 'Interpretation guidance is generalized and should not replace professional health advice.',
  },
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Maps a 0–100 stress score to a display label and Tailwind colour tokens.
 *
 * Thresholds mirror those described in the Stage 3 README:
 * - < 30  → Calm        (emerald)
 * - 30–59 → Moderate    (amber)
 * - ≥ 60  → High Stress (rose)
 *
 * @param score - Stress index in the range 0–100.
 * @returns An object with a human-readable `label`, a Tailwind text `color`
 *          class, and a Tailwind background `bg` class.
 */
const getStressLevel = (score: number): { label: string; color: string; bg: string } => {
  if (score < 30) return { label: 'Calm',       color: 'text-emerald-400', bg: 'bg-emerald-400/10' };
  if (score < 60) return { label: 'Moderate',   color: 'text-amber-400',   bg: 'bg-amber-400/10'   };
  return             { label: 'High Stress', color: 'text-rose-400',    bg: 'bg-rose-400/10'    };
};

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Root application component.
 *
 * Manages WebSerial connection state (via callbacks from {@link HeartbeatMonitor}),
 * live signal metrics, and the reading history persisted in localStorage.
 */
export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('serial');

  /** Live biometric signal state updated on every detected heartbeat peak. */
  const [signal, setSignal] = useState<SignalState>({
    bpm: 0,
    confidence: 0,
    stressScore: 0,
    isConnected: false,
    status: "Not connected",
  });

  /** Reading history loaded from localStorage (newest first). */
  const [history, setHistory] = useState<HeartbeatReading[]>([]);

  /** Controls whether the full-screen history overlay is visible. */
  const [showHistory, setShowHistory] = useState(false);
  /** Tracks which panel help modal is currently open. */
  const [activePanelInfo, setActivePanelInfo] = useState<PanelInfoKey | null>(null);
  /** Connection actions provided by the monitor component. */
  const [connectionControls, setConnectionControls] = useState<ConnectionControls | null>(null);

  // Load history from localStorage on first render.
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    const preferredLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    setThemeMode(preferredLight ? 'light' : 'dark');
  }, []);

  // ---------------------------------------------------------------------------
  // History persistence (localStorage)
  // ---------------------------------------------------------------------------

  /**
   * Called by {@link HeartbeatMonitor} on every newly detected heartbeat peak.
   * Updates the live stat cards and — with a 5 % probability — saves the
   * reading to localStorage and updates the history list.
   *
   * The probabilistic save rate (~5 readings per 100 peaks) keeps localStorage
   * from filling up during a long session while still producing a meaningful
   * trend over time.
   *
   * @param bpm         - Current heart rate in beats per minute.
   * @param confidence  - Signal confidence (0.0–1.0).
   * @param stressScore - Stress index (0–100).
   */
  const handleDataUpdate = (bpm: number, confidence: number, stressScore: number) => {
    setSignal(prev => ({ ...prev, bpm, confidence, stressScore }));

    // Save occasionally to avoid flooding localStorage.
    if (Math.random() > 0.95 && bpm > 0) {
      setHistory(saveReading(bpm, confidence, stressScore));
    }
  };

  // ---------------------------------------------------------------------------
  // Callbacks passed to HeartbeatMonitor
  // ---------------------------------------------------------------------------

  /**
   * Called by {@link HeartbeatMonitor} whenever the WebSerial connection state
   * changes (connect, disconnect, or error).
   *
   * @param isConnected - `true` if a port is open and data is flowing.
   * @param status      - Human-readable status string for the header badge.
   */
  const handleStatusChange = (isConnected: boolean, status: string) => {
    setSignal(prev => ({ ...prev, isConnected, status }));
  };

  const stress = getStressLevel(signal.stressScore);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={`min-h-screen text-white font-sans selection:bg-blue-500/30 flex flex-col ${themeMode === 'light' ? 'theme-light' : ''}`}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/5 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Sparkles className="text-white" size={18} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">AURA</h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-semibold">Stress Monitor v1.0</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Connection status badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
              <div className={`w-2 h-2 rounded-full ${signal.isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-xs font-medium text-white/60">{signal.status}</span>
            </div>
            {connectionControls && (
              <>
                <button
                  onClick={() => {
                    if (signal.isConnected) {
                      void connectionControls.disconnect();
                    } else if (connectionMode === 'serial') {
                      void connectionControls.connectSerial();
                    } else {
                      void connectionControls.connectBluetooth();
                    }
                  }}
                  className={`relative flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                    signal.isConnected
                      ? 'connect-primary-connected bg-white/5 border-white/10 text-white/75 hover:text-white hover:bg-white/10'
                      : 'connect-fill-animate connect-primary-disconnected border-blue-400/40 text-blue-100 hover:text-white'
                  }`}
                  aria-label={signal.isConnected ? 'Disconnect sensor' : 'Connect sensor'}
                >
                  <Zap size={14} className={signal.isConnected ? 'text-white/60' : 'text-blue-400'} fill={signal.isConnected ? 'none' : 'currentColor'} />
                  {signal.isConnected ? 'Disconnect Sensor' : 'Connect Sensor'}
                </button>
                <button
                  onClick={() => setConnectionMode(prev => (prev === 'serial' ? 'bluetooth' : 'serial'))}
                  className="source-toggle-button w-32 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Toggle connection source"
                >
                  {connectionMode === 'serial' ? <Usb size={13} /> : <Bluetooth size={13} />}
                  {connectionMode === 'serial' ? 'USB Serial' : 'Bluetooth LE'}
                </button>
                {!signal.isConnected && (
                  <span className="hidden lg:inline text-[10px] font-semibold tracking-wide text-white/50">
                    Choose source, then Connect
                  </span>
                )}
              </>
            )}
            <button
              onClick={() => setThemeMode(prev => (prev === 'dark' ? 'light' : 'dark'))}
              className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/60 hover:text-white"
              aria-label="Toggle theme mode"
            >
              {themeMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/60 hover:text-white"
              aria-label="Toggle reading history"
            >
              <History size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 lg:py-6 flex-1">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 lg:items-stretch">

          {/* ── Left column: waveform + stat cards ─────────────────────────── */}
          <div className="lg:col-span-8 h-full flex flex-col gap-5 lg:gap-6">
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs sm:text-sm font-semibold uppercase tracking-widest text-white/40 flex items-center gap-2">
                    <Activity size={16} />
                    Live Biometric Stream
                  </h2>
                  <button
                    onClick={() => setActivePanelInfo('stream')}
                    className="text-white/40 hover:text-white transition-colors"
                    aria-label="Open stream panel information"
                  >
                    <Info size={14} />
                  </button>
                </div>
                <div className="text-[10px] font-mono text-white/20">500 SAMPLES @ 100HZ</div>
              </div>
              {/* Canvas visualisation + WebSerial connection button */}
              <HeartbeatMonitor
                onDataUpdate={handleDataUpdate}
                onStatusChange={handleStatusChange}
                theme={themeMode}
                onConnectionControlReady={setConnectionControls}
              />
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
              {/* Signal Confidence card */}
              <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white/40">Signal Confidence</h3>
                    <button
                      onClick={() => setActivePanelInfo('confidence')}
                      className="text-white/40 hover:text-white transition-colors"
                      aria-label="Open signal confidence panel information"
                    >
                      <Info size={13} />
                    </button>
                  </div>
                  <ShieldCheck size={15} className={signal.confidence > 0.7 ? 'text-emerald-400' : 'text-amber-400'} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl lg:text-4xl font-light">{(signal.confidence * 100).toFixed(0)}</span>
                  <span className="text-base text-white/40">%</span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full ${signal.confidence > 0.7 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${signal.confidence * 100}%` }}
                  />
                </div>
              </div>

              {/* Heart Rate card */}
              <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white/40">Heart Rate</h3>
                    <button
                      onClick={() => setActivePanelInfo('heartRate')}
                      className="text-white/40 hover:text-white transition-colors"
                      aria-label="Open heart rate panel information"
                    >
                      <Info size={13} />
                    </button>
                  </div>
                  <Heart size={15} className="text-rose-500 animate-pulse" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl lg:text-4xl font-light">{signal.bpm > 0 ? signal.bpm.toFixed(0) : '--'}</span>
                  <span className="text-base text-white/40">BPM</span>
                </div>
                <p className="text-[10px] text-white/30 italic">Average resting: 60–100 BPM</p>
              </div>
            </div>
          </div>

          {/* ── Right column: stress panel + info cards ─────────────────────── */}
          <div className="lg:col-span-4 lg:h-full flex flex-col gap-5 lg:gap-6">
            {/* Stress Analysis panel — background tints with stress level */}
            <section className={`p-6 rounded-2xl border border-white/10 transition-colors duration-500 lg:flex-1 ${stress.bg}`}>
              <div className="flex items-center gap-3 mb-4 justify-between">
                <div className="flex items-center gap-3">
                  <Brain className={stress.color} size={20} />
                  <h2 className="text-xs sm:text-sm font-bold uppercase tracking-widest opacity-60">Stress Analysis</h2>
                </div>
                <button
                  onClick={() => setActivePanelInfo('stress')}
                  className="text-white/40 hover:text-white transition-colors"
                  aria-label="Open stress analysis panel information"
                >
                  <Info size={14} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="text-5xl lg:text-6xl font-light tracking-tighter mb-1">
                    {signal.stressScore.toFixed(0)}
                  </div>
                  <div className={`text-lg lg:text-xl font-medium ${stress.color}`}>
                    {stress.label}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <p className="text-xs sm:text-sm text-white/60 leading-relaxed">
                    {signal.stressScore < 30
                      ? "Your heart rate variability and rhythm suggest a state of deep relaxation."
                      : signal.stressScore < 60
                      ? "Moderate physiological activity detected. Maintain steady breathing."
                      : "High physiological arousal detected. Consider a short mindfulness break."}
                  </p>
                </div>
              </div>
            </section>

            {/* System Info card */}
            <section className="p-5 rounded-2xl bg-white/5 border border-white/10">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white/40 flex items-center gap-2">
                  <Cpu size={14} />
                  System Info
                </h3>
                <button
                  onClick={() => setActivePanelInfo('system')}
                  className="text-white/40 hover:text-white transition-colors"
                  aria-label="Open system info panel information"
                >
                  <Info size={13} />
                </button>
              </div>
              <ul className="space-y-3 text-xs text-white/50">
                <li className="flex justify-between">
                  <span>Sample Rate</span>
                  <span className="text-white/80">100 Hz</span>
                </li>
                <li className="flex justify-between">
                  <span>Filter Type</span>
                  <span className="text-white/80">Moving Avg (N=15)</span>
                </li>
                <li className="flex justify-between">
                  <span>Baseline</span>
                  <span className="text-white/80">Dynamic Subtraction</span>
                </li>
              </ul>
            </section>

            {/* Biometric Insights card */}
            <section className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white/40 flex items-center gap-2">
                  <TrendingUp size={14} />
                  Biometric Insights
                </h3>
                <button
                  onClick={() => setActivePanelInfo('insights')}
                  className="text-white/40 hover:text-white transition-colors"
                  aria-label="Open biometric insights panel information"
                >
                  <Info size={13} />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <h4 className="text-xs font-semibold text-white/80 mb-1">Heart Rate (BPM)</h4>
                  <p className="text-[11px] text-white/50 leading-relaxed">
                    Beats Per Minute measures your heart's activity. A resting heart rate between 60–100 BPM is typical for adults. Lower rates often indicate better cardiovascular fitness.
                  </p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white/80 mb-1">Stress Analysis</h4>
                  <p className="text-[11px] text-white/50 leading-relaxed">
                    The algorithm analyses Heart Rate Variability (HRV) and rhythm stability. High stress scores correlate with elevated BPM and irregular inter-beat intervals, suggesting physiological arousal.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* ── History overlay ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowHistory(false)}
            >
              <div
                className="w-full max-w-2xl bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 border-b border-white/10 flex justify-between items-center">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <History size={20} />
                    Reading History
                  </h2>
                  <button onClick={() => setShowHistory(false)} className="text-white/40 hover:text-white" aria-label="Close history">✕</button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-6">
                  {history.length === 0 ? (
                    <div className="text-center py-12 text-white/20 italic">No readings recorded yet.</div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-white/30 border-b border-white/5">
                          <th className="pb-4 font-medium">Time</th>
                          <th className="pb-4 font-medium">BPM</th>
                          <th className="pb-4 font-medium">Stress</th>
                          <th className="pb-4 font-medium text-right">Confidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {history.map((h) => (
                          <tr key={h.id} className="group">
                            <td className="py-4 text-white/60">{new Date(h.timestamp).toLocaleTimeString()}</td>
                            <td className="py-4 font-mono">{h.bpm.toFixed(0)}</td>
                            <td className="py-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${getStressLevel(h.stress_score).bg} ${getStressLevel(h.stress_score).color}`}>
                                {getStressLevel(h.stress_score).label}
                              </span>
                            </td>
                            <td className="py-4 text-right text-white/40">{(h.confidence * 100).toFixed(0)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Panel help modal ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {activePanelInfo && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
              onClick={() => setActivePanelInfo(null)}
            >
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                className="w-full max-w-lg bg-[#0a0a0a] border border-white/10 rounded-2xl p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <h3 className="text-base font-semibold tracking-tight">{PANEL_INFO[activePanelInfo].title}</h3>
                  <button
                    onClick={() => setActivePanelInfo(null)}
                    className="text-white/40 hover:text-white transition-colors"
                    aria-label="Close panel information"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-3 text-sm text-white/65 leading-relaxed">
                  <p>{PANEL_INFO[activePanelInfo].summary}</p>
                  <p><span className="text-white/85 font-semibold">What it means:</span> {PANEL_INFO[activePanelInfo].meaning}</p>
                  <p><span className="text-white/85 font-semibold">Practical tip:</span> {PANEL_INFO[activePanelInfo].tip}</p>
                  <p><span className="text-white/85 font-semibold">Limitations:</span> {PANEL_INFO[activePanelInfo].caution}</p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 border-t border-white/5 text-center">
        <p className="footer-meta text-xs text-white/20 tracking-widest uppercase">
          Built on{' '}
          <a
            href="https://github.com/tj60647/smart-object-foundations"
            className="footer-link underline underline-offset-2 hover:text-white/40 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            Smart Object Foundations
          </a>
          {' '}— MDes Prototyping, CCA
        </p>
      </footer>
    </div>
  );
}
