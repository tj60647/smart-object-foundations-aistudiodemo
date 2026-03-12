// =============================================================================
// File:    types.ts
// Project: Smart Object Foundations — MDes Prototyping, CCA
// Demo:    AI Studio — Heartbeat Detection + Stress Analysis
//
// Authors: Copilot
//          Thomas J McLeish
// License: MIT — see LICENSE in the root of this repository
// =============================================================================
//
// Shared TypeScript interfaces used across the React app and the Express API.
// Keeping types in one file ensures the frontend and backend agree on the
// shape of every data object without duplication.

// =============================================================================
// DATABASE / API TYPES
// =============================================================================

/**
 * A single heartbeat reading as returned by the `/api/history` endpoint and
 * stored in the SQLite `readings` table.
 *
 * Column names use snake_case to match the SQL schema; the React components
 * access them directly after JSON deserialisation.
 */
export interface HeartbeatReading {
  /** Auto-incremented primary key from the `readings` table. */
  id: number;
  /** Heart rate in beats per minute, derived from inter-beat intervals. */
  bpm: number;
  /**
   * Signal confidence as a fraction from 0.0 (unreliable) to 1.0 (perfect).
   * Computed from the coefficient of variation of recent inter-beat intervals:
   * lower variability → higher confidence.
   */
  confidence: number;
  /**
   * Stress index from 0 (calm) to 100 (high stress).
   * Combines a normalised BPM factor (high BPM → more stress) with an
   * inverted HRV factor (low variability → more stress).
   */
  stress_score: number;
  /** ISO-8601 timestamp inserted by the SQLite `CURRENT_TIMESTAMP` default. */
  timestamp: string;
}

// =============================================================================
// UI STATE TYPES
// =============================================================================

/**
 * Live signal state held in the root `App` component and updated on every
 * detected heartbeat peak.
 */
export interface SignalState {
  /** Most recent heart rate in BPM, or 0 if fewer than four peaks have been detected. */
  bpm: number;
  /**
   * Most recent confidence value (0.0–1.0).
   * Displayed as a percentage in the UI.
   */
  confidence: number;
  /**
   * Most recent stress score (0–100).
   * Thresholds: < 30 Calm, 30–60 Moderate, ≥ 60 High Stress.
   */
  stressScore: number;
  /** Whether the WebSerial port is currently open and streaming data. */
  isConnected: boolean;
  /** Human-readable connection status string shown in the header badge. */
  status: string;
}
