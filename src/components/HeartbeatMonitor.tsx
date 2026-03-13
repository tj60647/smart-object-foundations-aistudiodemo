// =============================================================================
// File:    HeartbeatMonitor.tsx
// Project: Smart Object Foundations — MDes Prototyping, CCA
// Demo:    AI Studio — Heartbeat Detection + Stress Analysis
//
// Authors: Copilot
//          Thomas J McLeish
// License: MIT — see LICENSE in the root of this repository
// =============================================================================
//
// PURPOSE
// -------
// This component is the React equivalent of the Stage 3 p5.js sketch
// (stage-3-heartbeat-detection/p5/sketch.js in the parent repository).
// It implements the complete five-step signal processing pipeline:
//
//   raw signal
//     → Step 1: background subtraction   (removes slow DC drift)
//     → Step 2: moving-average smoothing (removes fast noise)
//     → Step 3: differentiation          (finds the moment of each peak)
//     → Step 4: peak detection           (records when each beat occurs)
//     → Step 5: BPM + confidence         (calculates heart rate)
//
// A stress score is derived on top of BPM + HRV (see calculateStats).
//
// WHAT IS DIFFERENTIATION?
// -------------------------
// Differentiation measures the *rate of change* of the signal. For discrete
// (sampled) data we approximate it as:
//
//   slope = signal[now] − signal[one step ago]
//
// When the signal is rising, slope is positive.
// When the signal is falling, slope is negative.
// At the peak — transitioning from rising to falling — the slope crosses zero.
// This zero-crossing is exactly where the heartbeat peak is.
//
// WHAT IS PEAK DETECTION?
// -----------------------
// Two conditions must both be true to register a peak:
//   1. Zero-crossing: slope just changed from positive to negative.
//   2. Amplitude threshold: the current smoothed value exceeds
//      adaptiveThreshold (starts at AMPLITUDE_THRESHOLD_DEFAULT).
//      This prevents noise near the baseline from triggering false peaks.
//
// An additional refractory period (REFRACTORY_PERIOD_SAMPLES = 30 samples =
// 300 ms at 100 Hz) prevents a second detection within the same heartbeat.
//
// WHAT IS CONFIDENCE?
// -------------------
// Confidence measures how regular the inter-beat intervals (IBIs) are.
// We compute the coefficient of variation (CV = std dev / mean) of the
// filtered IBI list. A CV near 0 means very regular rhythm; near 1 means
// very irregular. Confidence = clamp(1 − CV / 0.2, 0, 1).
//
// WHAT IS THE STRESS SCORE?
// -------------------------
// Two factors are combined into a 0–100 index:
//   bpmFactor — how far BPM is above the resting lower bound (65 BPM).
//               0 at 65 BPM, 1 at 120 BPM.
//   hrvFactor — how high the coefficient of variation is (high CV = high HRV
//               = lower stress).
// stressScore = (bpmFactor × 0.7 + (1 − hrvFactor) × 0.3) × 100
//
// HOW TO USE
// ----------
// Wire a PulseSensor to GPIO A0 on an ESP32 v2 and upload:
//   stage-1-raw-waveform/stage_1_send_data/stage_1_send_data.ino
// (from https://github.com/tj60647/smart-object-foundations)
// The Arduino sketch sends "timestamp,value\n" lines at 115200 baud, 100 Hz.
// Click "Connect Sensor" in the UI to open the WebSerial port.

import React, { useEffect, useRef } from 'react';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Time between Arduino samples in ms. Must match the Arduino sketch (100 Hz → 10 ms). */
const SAMPLE_INTERVAL_MS = 10;

/**
 * Number of samples kept in the rolling display buffer.
 * 500 samples × 10 ms = 5 seconds of visible history.
 */
const BUFFER_SIZE = 500;

/**
 * Window size for the baseline (background subtraction) moving average.
 * 500 samples × 10 ms = 5 s — slow enough to capture only DC drift, not the
 * heartbeat itself.
 */
const BASELINE_N = 500;

/**
 * Window size for the smoothing moving average.
 * 15 samples × 10 ms = 150 ms — removes sample-to-sample jitter while
 * preserving the shape of each heartbeat peak.
 */
const SMOOTH_N = 15;

/**
 * Starting amplitude threshold for peak detection.
 * The cleaned signal is centred around 0. Heartbeat peaks typically rise
 * 50–300 units above zero. Increase this value if noise triggers false peaks;
 * decrease it if real beats are missed.
 */
const AMPLITUDE_THRESHOLD_DEFAULT = 80;

/**
 * Maximum number of peak timestamps to remember.
 * ~15 peaks yields ~14 inter-beat intervals — enough for a stable BPM and
 * confidence estimate.
 */
const MAX_PEAKS_STORED = 15;

/**
 * Minimum number of samples between successive detected peaks.
 * 30 samples × 10 ms = 300 ms → maximum detectable rate of ~200 BPM.
 * Prevents a single heartbeat from triggering two detections.
 */
const REFRACTORY_PERIOD_SAMPLES = 30;

// =============================================================================
// PROPS
// =============================================================================

/**
 * Props for the {@link HeartbeatMonitor} component.
 */
interface HeartbeatMonitorProps {
  /**
   * Called on every newly detected heartbeat peak with updated biometric stats.
   * @param bpm         - Heart rate in beats per minute.
   * @param confidence  - Signal confidence (0.0–1.0).
   * @param stressScore - Stress index (0–100).
   */
  onDataUpdate: (bpm: number, confidence: number, stressScore: number) => void;
  /**
   * Called whenever the WebSerial connection state changes.
   * @param connected - `true` if the port is open and data is flowing.
   * @param status    - Human-readable status string.
   */
  onStatusChange: (connected: boolean, status: string) => void;
  /** Current visual theme so the canvas palette can match app mode. */
  theme: 'dark' | 'light';
  /**
   * Provides connect/disconnect actions to the parent so controls can live
   * outside the canvas (for example in a sticky header).
   */
  onConnectionControlReady?: (controls: {
    connectSerial: () => Promise<void>;
    connectBluetooth: () => Promise<void>;
    disconnect: () => Promise<void>;
  }) => void;
}

// BLE UART profiles commonly used by ESP32 and BLE serial bridges.
const BLE_NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const BLE_NUS_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const BLE_SPP_SERVICE = 0xffe0;
const BLE_SPP_CHAR = 0xffe1;

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Connects to an ESP32 via WebSerial, runs the five-step heartbeat-detection
 * pipeline on each incoming sample, and renders a real-time four-panel canvas —
 * one panel per pipeline stage:
 * - **Cyan   (panel 0)** — Stage 0: raw 12-bit ADC values (0–4095)
 * - **Green  (panel 1)** — Stage 1: DC-free signal after background subtraction
 * - **Amber  (panel 2)** — Stage 2: smoothed signal (moving avg)
 *   with a dashed white adaptive threshold and rose beat tick marks
 * - **Violet (panel 3)** — Stage 3: derivative (slope) signal
 */
export const HeartbeatMonitor: React.FC<HeartbeatMonitorProps> = ({ onDataUpdate, onStatusChange, onConnectionControlReady, theme }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const portRef   = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const bleDeviceRef = useRef<any>(null);
  const bleCharRef = useRef<any>(null);
  const blePartialRef = useRef<string>('');
  const bleListenerRef = useRef<((event: Event) => void) | null>(null);
  const keepReading = useRef<boolean>(true);
  const decoderRef = useRef<TextDecoder>(new TextDecoder());

  // ── Signal processing state ────────────────────────────────────────────────
  // All processing state is kept in refs (not useState) so that the 100 Hz
  // sample loop never triggers a React re-render.

  /** Rolling display buffer for the raw ADC signal (0–4095). */
  const rawBuffer = useRef<number[]>(new Array(BUFFER_SIZE).fill(2047.5));
  /** Rolling display buffer for the DC-free signal (Step 1: background subtraction). */
  const dcFreeBuffer = useRef<number[]>(new Array(BUFFER_SIZE).fill(0));
  /** Rolling display buffer for the cleaned (DC-free, smoothed) signal (Step 2). */
  const smoothedBuffer = useRef<number[]>(new Array(BUFFER_SIZE).fill(0));
  /** Rolling display buffer for the derivative (slope) signal (Step 3). */
  const derivBuffer = useRef<number[]>(new Array(BUFFER_SIZE).fill(0));

  // Step 1 — background subtraction
  /** Rolling window of raw samples used to estimate the DC baseline. */
  const baselineWindow = useRef<number[]>(new Array(BASELINE_N).fill(2047.5));
  /** Running sum of baselineWindow — updated cheaply on each new sample. */
  const baselineSum = useRef<number>(BASELINE_N * 2047.5);

  // Step 2 — smoothing
  /** Rolling window of DC-free samples for the moving-average smoother. */
  const smoothWindow = useRef<number[]>([]);

  // Step 3 — differentiation
  /** Smoothed value from the previous sample, used to compute slope. */
  const prevSmoothed = useRef<number>(0);
  /** Slope (derivative) from the previous sample, used for zero-crossing detection. */
  const prevSlope = useRef<number>(0);

  // Step 4 — peak detection
  /** Global sample counter. Incremented on every new sample. */
  const sampleCount = useRef<number>(0);
  /** Sample indices at which peaks were most recently detected. */
  const peakSampleCounts = useRef<number[]>([]);
  /**
   * Adaptive amplitude threshold. Starts at AMPLITUDE_THRESHOLD_DEFAULT and
   * slowly tracks the height of recent peaks so it adapts to sensor placement
   * and lighting conditions.
   */
  const adaptiveThreshold = useRef<number>(AMPLITUDE_THRESHOLD_DEFAULT);
  /** Sample index of the last detected peak, used to enforce the refractory period. */
  const lastPeakSample = useRef<number>(0);

  // ── WebSerial ──────────────────────────────────────────────────────────────

  /**
   * Closes the WebSerial port and cleans up the reader.
   * Safe to call even if the port was never opened.
   */
  const handleIncomingLine = (line: string) => {
    const parts = line.trim().split(',');
    // Expected format: "timestamp,value" — we only use the value.
    if (parts.length === 2) {
      const val = parseInt(parts[1]);
      if (!isNaN(val)) processSample(val);
    }
  };

  const disconnectSerial = async () => {
    keepReading.current = false;
    if (readerRef.current) {
      await readerRef.current.cancel();
      readerRef.current = null;
    }
    if (portRef.current) {
      await portRef.current.close();
      portRef.current = null;
    }
  };

  const disconnectBluetooth = async () => {
    const characteristic = bleCharRef.current;
    const listener = bleListenerRef.current;
    if (characteristic && listener) {
      characteristic.removeEventListener('characteristicvaluechanged', listener);
    }
    if (characteristic) {
      try {
        await characteristic.stopNotifications();
      } catch {
        // Ignore notification stop errors while disconnecting.
      }
    }
    bleCharRef.current = null;
    bleListenerRef.current = null;
    blePartialRef.current = '';

    const device = bleDeviceRef.current;
    if (device?.gatt?.connected) {
      device.gatt.disconnect();
    }
    bleDeviceRef.current = null;
  };

  const disconnectAll = async () => {
    await disconnectSerial();
    await disconnectBluetooth();
    onStatusChange(false, 'Disconnected');
  };

  /**
   * Prompts the user to select a serial port and opens it at 115200 baud,
   * then starts the read loop.
   */
  const connectSerial = async () => {
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      keepReading.current = true;

      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
      readerRef.current = decoder.readable.getReader();

      onStatusChange(true, 'Connected (Serial)');
      readLoop();
    } catch (err) {
      onStatusChange(false, 'Serial connection failed.');
      console.error(err);
    }
  };

  const connectBluetooth = async () => {
    if (!(navigator as any).bluetooth) {
      onStatusChange(false, 'Bluetooth not supported in this browser.');
      return;
    }

    try {
      await disconnectAll();

      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BLE_NUS_SERVICE, BLE_SPP_SERVICE],
      });
      bleDeviceRef.current = device;

      const server = await device.gatt?.connect();
      if (!server) {
        onStatusChange(false, 'Bluetooth GATT connection failed.');
        return;
      }

      let characteristic: any = null;

      try {
        const nusService = await server.getPrimaryService(BLE_NUS_SERVICE);
        characteristic = await nusService.getCharacteristic(BLE_NUS_TX_CHAR);
      } catch {
        const sppService = await server.getPrimaryService(BLE_SPP_SERVICE);
        characteristic = await sppService.getCharacteristic(BLE_SPP_CHAR);
      }

      if (!characteristic) {
        onStatusChange(false, 'Bluetooth stream characteristic not found.');
        return;
      }

      bleCharRef.current = characteristic;
      blePartialRef.current = '';

      const notificationHandler = (event: Event) => {
        const target = event.target as any;
        const value = target.value;
        if (!value) return;

        const chunk = decoderRef.current.decode(value.buffer);
        blePartialRef.current += chunk;

        const lines = blePartialRef.current.split('\n');
        blePartialRef.current = lines.pop() || '';
        lines.forEach(handleIncomingLine);
      };

      bleListenerRef.current = notificationHandler;
      characteristic.addEventListener('characteristicvaluechanged', notificationHandler);
      await characteristic.startNotifications();

      onStatusChange(true, 'Connected (Bluetooth)');
    } catch (err) {
      onStatusChange(false, 'Bluetooth connection failed.');
      console.error(err);
    }
  };

  // Expose connection controls to the parent UI.
  useEffect(() => {
    onConnectionControlReady?.({
      connectSerial,
      connectBluetooth,
      disconnect: disconnectAll,
    });
  }, [onConnectionControlReady]);

  /**
   * Continuously reads lines from the serial port and dispatches each
   * valid `timestamp,value` line to {@link processSample}.
   *
   * The Arduino sketch sends lines formatted as: `<millis>,<adcValue>\n`
   * e.g. `1234,2048`
   *
   * Lines are accumulated in a partial buffer to handle chunks that split
   * across newlines.
   */
  const readLoop = async () => {
    let partial = "";
    while (keepReading.current) {
      try {
        const { value, done } = await readerRef.current.read();
        if (done || !keepReading.current) break;
        partial += value;
        const lines = partial.split("\n");
        partial = lines.pop() || "";

        for (const line of lines) {
          handleIncomingLine(line);
        }
      } catch (err) {
        if (keepReading.current) {
          onStatusChange(false, "Serial read error");
        }
        break;
      }
    }
  };

  // ── Signal processing ──────────────────────────────────────────────────────

  /**
   * Runs the full five-step pipeline on a single raw ADC sample.
   * Called at ~100 Hz from the serial read loop.
   *
   * @param raw - Raw 12-bit ADC value from the ESP32 (0–4095).
   */
  const processSample = (raw: number) => {
    sampleCount.current++;

    // Update the raw display buffer (rolling window).
    rawBuffer.current.push(raw);
    rawBuffer.current.shift();

    // Step 1 — Background subtraction (high-pass filter effect).
    // The baseline is the mean of the last BASELINE_N raw samples.
    // Subtracting it removes slow DC drift and centres the signal around 0.
    baselineSum.current -= baselineWindow.current.shift()!;
    baselineWindow.current.push(raw);
    baselineSum.current += raw;
    const dc = raw - baselineSum.current / BASELINE_N;

    // Store Stage 1 output for visualisation.
    dcFreeBuffer.current.push(dc);
    dcFreeBuffer.current.shift();

    // Step 2 — Smoothing (low-pass filter effect).
    // A moving average of SMOOTH_N samples blurs out high-frequency jitter
    // while preserving the shape of each heartbeat peak.
    smoothWindow.current.push(dc);
    if (smoothWindow.current.length > SMOOTH_N) smoothWindow.current.shift();
    const sm = smoothWindow.current.reduce((a, b) => a + b, 0) / smoothWindow.current.length;

    smoothedBuffer.current.push(sm);
    smoothedBuffer.current.shift();

    // Step 3 — Differentiation.
    // slope > 0: signal is rising; slope ≤ 0: signal is falling or flat.
    // The transition from positive to negative slope (zero-crossing) marks
    // the moment the signal peaks.
    const slope = sm - prevSmoothed.current;

    // Store Stage 3 output for visualisation.
    derivBuffer.current.push(slope);
    derivBuffer.current.shift();

    // Step 4 — Peak detection (adaptive threshold + refractory period).
    const isPeakCandidate = prevSlope.current > 0 && slope <= 0;
    const timeSinceLastPeak = sampleCount.current - lastPeakSample.current;

    if (isPeakCandidate && sm > adaptiveThreshold.current && timeSinceLastPeak > REFRACTORY_PERIOD_SAMPLES) {
      peakSampleCounts.current.push(sampleCount.current);
      if (peakSampleCounts.current.length > MAX_PEAKS_STORED) peakSampleCounts.current.shift();

      // Slowly update the adaptive threshold toward 60 % of the current peak
      // height. This allows the detector to follow changes in sensor pressure
      // or ambient light without manual re-calibration.
      adaptiveThreshold.current = adaptiveThreshold.current * 0.9 + sm * 0.1 * 0.6;
      // Clamp: never fall below the default, never exceed a practical maximum.
      adaptiveThreshold.current = Math.max(AMPLITUDE_THRESHOLD_DEFAULT, Math.min(500, adaptiveThreshold.current));

      lastPeakSample.current = sampleCount.current;

      // Step 5 — BPM, confidence, and stress score.
      const stats = calculateStats();
      onDataUpdate(stats.bpm, stats.confidence, stats.stressScore);

    } else if (timeSinceLastPeak > 200) {
      // No peak detected for 2 s → slowly lower the threshold so the detector
      // can re-acquire after sensor movement or noise.
      adaptiveThreshold.current *= 0.99;
      adaptiveThreshold.current = Math.max(AMPLITUDE_THRESHOLD_DEFAULT, adaptiveThreshold.current);
    }

    prevSmoothed.current = sm;
    prevSlope.current = slope;
  };

  /**
   * Computes BPM, confidence, and stress score from the stored peak timestamps.
   *
   * **BPM** is derived from the mean inter-beat interval (IBI):
   * `BPM = 60 000 ms / mean IBI`
   *
   * **Confidence** uses the coefficient of variation (CV = std dev / mean) of
   * filtered IBIs: `confidence = clamp(1 − CV / 0.2, 0, 1)`. Lower CV
   * (more regular rhythm) → higher confidence.
   *
   * **Stress score** combines:
   * - `bpmFactor` — normalised distance above 65 BPM (0 at 65, 1 at 120)
   * - `hrvFactor` — CV relative to 0.15 (higher CV = higher HRV = lower stress)
   * `stressScore = (bpmFactor × 0.7 + (1 − hrvFactor) × 0.3) × 100`
   *
   * Returns zeros when fewer than four peaks have been detected (not enough
   * data for a meaningful estimate).
   *
   * @returns An object with `bpm`, `confidence`, and `stressScore`.
   */
  const calculateStats = (): { bpm: number; confidence: number; stressScore: number } => {
    if (peakSampleCounts.current.length < 4) return { bpm: 0, confidence: 0, stressScore: 0 };

    // Convert peak sample indices to IBI values in milliseconds.
    const intervals: number[] = [];
    for (let i = 1; i < peakSampleCounts.current.length; i++) {
      intervals.push((peakSampleCounts.current[i] - peakSampleCounts.current[i - 1]) * SAMPLE_INTERVAL_MS);
    }

    // Remove outliers (double detections or missed beats) by keeping only
    // intervals within 50–150 % of the median.
    const median = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
    const filteredIntervals = intervals.filter(v => v > median * 0.5 && v < median * 1.5);

    if (filteredIntervals.length < 2) return { bpm: 0, confidence: 0, stressScore: 0 };

    const mean = filteredIntervals.reduce((a, b) => a + b, 0) / filteredIntervals.length;
    const bpm  = 60000 / mean;

    // Coefficient of variation — a scale-independent measure of rhythm regularity.
    const variance = filteredIntervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / filteredIntervals.length;
    const stdDev   = Math.sqrt(variance);
    const cv       = stdDev / mean;

    // Confidence: lower CV → more regular → higher confidence.
    const confidence = Math.max(0, Math.min(1, 1 - cv / 0.2));

    // Stress factors.
    const bpmFactor = Math.min(1, Math.max(0, (bpm - 65) / 55)); // 0 at 65 BPM, 1 at 120 BPM
    const hrvFactor = Math.min(1, cv / 0.15);                     // higher CV → lower stress
    const stressScore = (bpmFactor * 0.7 + (1 - hrvFactor) * 0.3) * 100;

    return { bpm, confidence, stressScore };
  };

  // ── Canvas animation loop ──────────────────────────────────────────────────

  /**
   * Starts a `requestAnimationFrame` render loop that draws the four-panel
   * waveform onto the canvas at the browser's display refresh rate (~60 fps).
   *
   * The canvas is divided into four equal horizontal panels, one per pipeline stage:
   * - **Panel 0 — cyan**   — Stage 0: raw 12-bit ADC values (0–4095)
   * - **Panel 1 — green**  — Stage 1: DC-free signal (background subtracted, ±600)
   * - **Panel 2 — amber**  — Stage 2: smoothed signal (moving avg, ±400)
   *   with a dashed white adaptive threshold line and rose beat tick marks
   * - **Panel 3 — violet** — Stage 3: derivative / slope signal (±60)
   *
   * Cleanup cancels the animation frame and disconnects the serial port.
   */
  useEffect(() => {
    let animationFrameId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const w      = canvas.width;
      const h      = canvas.height;
      const panelH = h / 4;   // four equal panels

      const palette = theme === 'dark'
        ? {
            background: '#050505',
            grid: '#111',
            zero: 'rgba(255, 255, 255, 0.08)',
            threshold: 'rgba(255, 255, 255, 0.15)',
            divider: '#222',
            label: 'rgba(255, 255, 255, 0.25)',
          }
        : {
            background: '#f3f7fb',
            grid: '#d4dde7',
            zero: 'rgba(15, 23, 42, 0.18)',
            threshold: 'rgba(15, 23, 42, 0.3)',
            divider: '#c0ccd9',
            label: 'rgba(15, 23, 42, 0.55)',
          };

      // Background
      ctx.fillStyle = palette.background;
      ctx.fillRect(0, 0, w, h);

      // Subtle grid
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 50) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
      }
      for (let i = 0; i < h; i += 50) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
      }

      /**
       * Maps a signal value in [minVal, maxVal] to a y-pixel within the
       * given panel (0-indexed from the top).  High values → top of panel.
       * When minVal === maxVal the panel midpoint is returned.
       */
      const mapToPanel = (value: number, minVal: number, maxVal: number, panelIdx: number): number => {
        const pTop    = panelIdx * panelH + 20;
        const pBottom = (panelIdx + 1) * panelH - 20;
        if (minVal === maxVal) return (pTop + pBottom) / 2;
        const ratio   = (value - minVal) / (maxVal - minVal);
        return pBottom - ratio * (pBottom - pTop);
      };

      // ── Panel 0: Raw ADC signal (cyan) ───────────────────────────────────
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < rawBuffer.current.length; i++) {
        const x = (i / (BUFFER_SIZE - 1)) * w;
        const y = mapToPanel(rawBuffer.current[i], 0, 4095, 0);
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
      }
      ctx.stroke();

      // ── Panel 1: DC-free signal / Stage 1 — green ────────────────────────
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < dcFreeBuffer.current.length; i++) {
        const x = (i / (BUFFER_SIZE - 1)) * w;
        const y = mapToPanel(dcFreeBuffer.current[i], -600, 600, 1);
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Zero reference line
      ctx.strokeStyle = palette.zero;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, mapToPanel(0, -600, 600, 1));
      ctx.lineTo(w, mapToPanel(0, -600, 600, 1));
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Panel 2: Smoothed signal / Stage 2 — amber + peaks + threshold ───
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < smoothedBuffer.current.length; i++) {
        const x = (i / (BUFFER_SIZE - 1)) * w;
        const y = mapToPanel(smoothedBuffer.current[i], -400, 400, 2);
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Adaptive threshold line
      ctx.strokeStyle = palette.threshold;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, mapToPanel(adaptiveThreshold.current, -400, 400, 2));
      ctx.lineTo(w, mapToPanel(adaptiveThreshold.current, -400, 400, 2));
      ctx.stroke();
      ctx.setLineDash([]);

      // Peak tick marks
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      peakSampleCounts.current.forEach(ps => {
        const samplesAgo = sampleCount.current - ps;
        if (samplesAgo >= 0 && samplesAgo < BUFFER_SIZE) {
          const x     = ((BUFFER_SIZE - samplesAgo) / (BUFFER_SIZE - 1)) * w;
          const pTop    = mapToPanel(400,  -400, 400, 2);
          const pBottom = mapToPanel(-400, -400, 400, 2);
          ctx.beginPath();
          ctx.moveTo(x, pTop);
          ctx.lineTo(x, pBottom);
          ctx.stroke();
          ctx.fillStyle = '#f43f5e';
          ctx.beginPath();
          ctx.arc(x, pTop, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // ── Panel 3: Derivative / Stage 3 — violet ───────────────────────────
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < derivBuffer.current.length; i++) {
        const x = (i / (BUFFER_SIZE - 1)) * w;
        const y = mapToPanel(derivBuffer.current[i], -60, 60, 3);
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Zero reference line
      ctx.strokeStyle = palette.zero;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, mapToPanel(0, -60, 60, 3));
      ctx.lineTo(w, mapToPanel(0, -60, 60, 3));
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Panel dividers ────────────────────────────────────────────────────
      ctx.strokeStyle = palette.divider;
      ctx.lineWidth = 1;
      for (let p = 1; p < 4; p++) {
        ctx.beginPath();
        ctx.moveTo(0, p * panelH);
        ctx.lineTo(w, p * panelH);
        ctx.stroke();
      }

      // ── Panel labels ──────────────────────────────────────────────────────
      ctx.fillStyle = palette.label;
      ctx.font = '11px monospace';
      ctx.fillText('STAGE 0 — RAW ADC (0–4095)', 10, 16);
      ctx.fillText('STAGE 1 — DC-FREE (background subtracted)', 10, panelH + 16);
      ctx.fillText('STAGE 2 — SMOOTHED (moving avg)  |  ── threshold  ╋ beats', 10, 2 * panelH + 16);
      ctx.fillText('STAGE 3 — DERIVATIVE (slope)', 10, 3 * panelH + 16);

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (portRef.current || bleDeviceRef.current) {
        void disconnectAll();
      }
    };
  }, [theme]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full bg-[#0a0a0a] rounded-2xl overflow-hidden border border-white/5 shadow-2xl group">
      <canvas
        ref={canvasRef}
        width={1200}
        height={760}
        className="w-full h-auto block"
      />

      {/* Trace legend */}
      <div className="absolute bottom-3 right-3 hidden md:flex items-center gap-3 text-[9px] font-mono text-white/20 uppercase tracking-widest">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-cyan-400" />
          Raw ADC
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          DC-Free
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          Smoothed
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-violet-400" />
          Derivative
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-rose-400" />
          Beats
        </div>
      </div>
    </div>
  );
};
