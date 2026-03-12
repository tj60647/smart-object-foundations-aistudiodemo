<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Smart Object Foundations — AI Studio Demo

## About This Repository

This repository is an **AI Studio demo** that extends [Smart Object Foundations](https://github.com/tj60647/smart-object-foundations) — a project in the MDes Prototyping course at CCA.

It takes the complete signal-processing pipeline developed in **Stage 3 (Heartbeat Detection)** of the main sequence and re-implements it as a full-stack React + TypeScript web application, replacing the original p5.js sketch with a production-quality UI, persistent reading history, and a stress-analysis layer powered by heart rate variability (HRV).

> **Base code:** This demo is built directly from the logic in [`stage-3-heartbeat-detection/p5/sketch.js`](https://github.com/tj60647/smart-object-foundations/blob/main/stage-3-heartbeat-detection/p5/sketch.js) in the parent repository. Every signal-processing constant and algorithm (baseline subtraction, moving-average smoothing, differentiation, adaptive peak detection, BPM + confidence) maps 1-to-1 to the p5.js original.

---

## What It Does

A real-time heartbeat detector and stress monitor running across hardware and software:

```
fingertip → PulseSensor → ESP32 analogRead() → Serial → WebSerial → React app
                                                                         ↓
                                                               raw waveform displayed
                                                                         ↓
                                                          background subtracted + smoothed
                                                                         ↓
                                                          peaks detected → BPM + confidence
                                                                         ↓
                                                           stress score (HRV + BPM analysis)
                                                                         ↓
                                                           reading saved to SQLite via Express
```

### The Signal Processing Pipeline

The app implements the same five-step pipeline from Stage 3:

| Step | Technique | Constants |
|---|---|---|
| 1 — Background subtraction | Moving-average baseline (`BASELINE_N = 500`) | Removes slow DC drift |
| 2 — Smoothing | Moving average (`SMOOTH_N = 15`) | Removes sample-to-sample jitter |
| 3 — Differentiation | `slope = signal[n] − signal[n−1]` | Detects zero-crossings at peaks |
| 4 — Peak detection | Adaptive threshold + 300 ms refractory period | Records beat timestamps |
| 5 — BPM + confidence | Inter-beat interval statistics (mean + CV) | Reports heart rate and regularity |

A **stress score** is layered on top: it combines the normalised BPM factor (high BPM → higher stress) with an inverted HRV factor (low variability → higher stress), producing a 0–100 index colour-coded as Calm / Moderate / High Stress.

### What Is New Compared to Stage 3

| Stage 3 (p5.js sketch) | This Demo (React + TypeScript) |
|---|---|
| Standalone browser sketch | Full-stack app: Express server + React SPA |
| In-memory state only | Persistent SQLite history via `/api/readings` |
| Canvas rendered by p5.js | Canvas rendered by `requestAnimationFrame` loop in React |
| No stress analysis | Stress score derived from BPM + HRV coefficient of variation |
| Plain JavaScript | TypeScript with TSDoc comments |
| No packaging | Vite build, `npm run dev` / `npm run build` |

---

## Where This Fits in the Sequence

| Repository | Focus |
|---|---|
| [**Smart Object Foundations**](https://github.com/tj60647/smart-object-foundations) | ESP32 → WebSerial → p5.js signal processing, Stage 0–3 |
| → **Smart Object Foundations AI Studio Demo** *(you are here)* | Stage 3 pipeline re-implemented as a React + TypeScript production app |

---

## Hardware

The app uses the same hardware wiring as the rest of the sequence:

| PulseSensor wire | ESP32 v2 pin |
|---|---|
| Red (power) | 3.3V |
| Black (ground) | GND |
| Purple (signal) | A0 |

Upload the Arduino sketch from the parent repository to your ESP32 before connecting:
[`stage-1-raw-waveform/stage_1_send_data/stage_1_send_data.ino`](https://github.com/tj60647/smart-object-foundations/blob/main/stage-1-raw-waveform/stage_1_send_data/stage_1_send_data.ino)

The sketch sends lines formatted as `timestamp,value` over Serial at 115200 baud and 100 Hz. **No changes to the Arduino sketch are needed for this demo.**

---

## Run Locally

**Prerequisites:** Node.js, Chrome or Edge (WebSerial requires a Chromium-based browser)

1. Install dependencies:
   ```
   npm install
   ```
2. Set the `GEMINI_API_KEY` in [`.env.local`](.env.local) to your Gemini API key
3. Run the app:
   ```
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in Chrome or Edge
5. Click **Connect Sensor**, select the ESP32 serial port, and place your fingertip on the PulseSensor

The canvas will show two traces:
- **Cyan (top)** — raw 12-bit ADC signal from the ESP32
- **Amber (bottom)** — baseline-subtracted, smoothed signal with red tick marks at each detected beat

---

## Project Structure

```
server.ts                  ← Express server: /api/readings (POST) + /api/history (GET)
src/
  main.tsx                 ← React entry point
  App.tsx                  ← Root component: layout, stat cards, history overlay
  types.ts                 ← Shared TypeScript interfaces
  components/
    HeartbeatMonitor.tsx   ← WebSerial + signal processing + Canvas visualisation
  index.css                ← Tailwind v4 + font imports
index.html                 ← HTML entry point
vite.config.ts             ← Vite + React + Tailwind plugins
tsconfig.json              ← TypeScript configuration
```

---

## License

MIT — see [LICENSE](LICENSE).

Built as part of the MDes Prototyping course at [CCA](https://www.cca.edu).
