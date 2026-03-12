// =============================================================================
// File:    server.ts
// Project: Smart Object Foundations — MDes Prototyping, CCA
// Demo:    AI Studio — Heartbeat Detection + Stress Analysis
//
// Authors: Copilot
//          Thomas J McLeish
// License: MIT — see LICENSE in the root of this repository
// =============================================================================
//
// Express server that:
//   1. Initialises a SQLite database (`heartbeat.db`) with a `readings` table.
//   2. Exposes two JSON API endpoints:
//        GET  /api/history  — returns the 100 most-recent readings (newest first)
//        POST /api/readings — persists a new bpm / confidence / stress_score row
//   3. In development, forwards all other requests to the Vite dev server
//      (hot-module replacement, etc.).
//   4. In production, serves the compiled static bundle from `dist/`.

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import rateLimit from "express-rate-limit";

// =============================================================================
// DATABASE
// =============================================================================

const db = new Database("heartbeat.db");

/**
 * Create the `readings` table if it does not already exist.
 *
 * Schema:
 *   id           INTEGER  — auto-incremented primary key
 *   bpm          REAL     — heart rate in beats per minute
 *   confidence   REAL     — signal confidence (0.0–1.0)
 *   stress_score REAL     — stress index (0–100)
 *   timestamp    DATETIME — insertion time (UTC), set automatically
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bpm REAL,
    confidence REAL,
    stress_score REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// =============================================================================
// SERVER
// =============================================================================

async function startServer() {
  const app  = express();
  const PORT = 3000;

  app.use(express.json());

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  /**
   * Shared rate limiter for all API routes.
   * Allows up to 120 requests per minute per IP — generous enough for the
   * ~5 % save rate from the React app's 100 Hz loop, but strict enough to
   * prevent abuse in a shared or publicly-accessible deployment.
   */
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use("/api", apiLimiter);

  // ---------------------------------------------------------------------------
  // API Routes
  // ---------------------------------------------------------------------------

  /**
   * GET /api/history
   *
   * Returns up to 100 of the most-recent readings, ordered newest-first.
   * The React app uses this to populate the history overlay table.
   */
  app.get("/api/history", (_req, res) => {
    const readings = db
      .prepare("SELECT * FROM readings ORDER BY timestamp DESC LIMIT 100")
      .all();
    res.json(readings);
  });

  /**
   * POST /api/readings
   *
   * Persists a single heartbeat reading. The request body must contain:
   *   { bpm: number, confidence: number, stressScore: number }
   *
   * Rows with bpm ≤ 0 are silently ignored (invalid / uninitialised readings).
   */
  app.post("/api/readings", (req, res) => {
    const { bpm, confidence, stressScore } = req.body as {
      bpm: number;
      confidence: number;
      stressScore: number;
    };
    if (bpm > 0) {
      db
        .prepare("INSERT INTO readings (bpm, confidence, stress_score) VALUES (?, ?, ?)")
        .run(bpm, confidence, stressScore);
    }
    res.json({ status: "ok" });
  });

  // ---------------------------------------------------------------------------
  // Static / Vite middleware
  // ---------------------------------------------------------------------------

  if (process.env.NODE_ENV !== "production") {
    // Development: proxy all non-API requests through the Vite dev server so
    // the React SPA gets hot-module replacement.
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve the pre-built static bundle from `dist/`.
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));

    /**
     * Rate limiter for the SPA catch-all route.
     * Prevents rapid scraping of the HTML shell in production deployments.
     */
    const staticLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.get("*", staticLimiter, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
