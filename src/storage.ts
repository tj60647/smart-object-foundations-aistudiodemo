// =============================================================================
// File:    storage.ts
// Project: Smart Object Foundations — MDes Prototyping, CCA
// Demo:    AI Studio — Heartbeat Detection + Stress Analysis
//
// Authors: Copilot
//          Thomas J McLeish
// License: MIT — see LICENSE in the root of this repository
// =============================================================================
//
// localStorage-based persistence layer for reading history.
//
// WHY localStorage?
// -----------------
// The app is deployed as a static site on GitHub Pages, which can only serve
// files — there is no server process available to run Express or SQLite.
// All signal-processing and WebSerial code is purely client-side and works
// perfectly in a static deployment. History is persisted in the browser's
// localStorage so the feature continues to work without a back-end.
//
// When running locally with `npm run dev` the same localStorage store is used,
// which means history is per-browser and survives page reloads just as it
// would with a dedicated server.
//
// STORAGE FORMAT
// --------------
// Key:   HISTORY_KEY ("aura_history")
// Value: JSON array of HeartbeatReading objects (newest first, max 100 entries).
//
// The HeartbeatReading shape (snake_case field names) is kept identical to the
// SQLite schema so the history table in App.tsx requires no changes.

import type { HeartbeatReading } from './types';

// =============================================================================
// CONSTANTS
// =============================================================================

/** localStorage key under which the reading history array is stored. */
const HISTORY_KEY = 'aura_history';

/**
 * Maximum number of readings to keep in localStorage.
 * Older entries beyond this limit are silently dropped.
 */
const MAX_HISTORY = 100;

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Returns the persisted reading history, newest entry first.
 *
 * Returns an empty array if localStorage is unavailable or the stored value
 * cannot be parsed (e.g. corrupted data from a previous session).
 */
export const loadHistory = (): HeartbeatReading[] => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as HeartbeatReading[];
  } catch {
    return [];
  }
};

/**
 * Prepends a new reading to the persisted history and returns the updated list.
 *
 * The list is capped at {@link MAX_HISTORY} entries to prevent unbounded
 * localStorage growth over long sessions.
 *
 * @param bpm         - Heart rate in beats per minute.
 * @param confidence  - Signal confidence (0.0–1.0).
 * @param stressScore - Stress index (0–100); stored as `stress_score` to match
 *                      the {@link HeartbeatReading} interface.
 * @returns The updated history array (newest first).
 */
export const saveReading = (
  bpm: number,
  confidence: number,
  stressScore: number,
): HeartbeatReading[] => {
  const entry: HeartbeatReading = {
    id: Date.now(),
    bpm,
    confidence,
    stress_score: stressScore,
    timestamp: new Date().toISOString(),
  };
  const updated = [entry, ...loadHistory()].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    // localStorage may be unavailable (e.g. in a sandboxed iframe). Fail
    // silently — losing history persistence is acceptable for a demo app.
  }
  return updated;
};
