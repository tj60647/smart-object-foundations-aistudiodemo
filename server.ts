import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";

const db = new Database("heartbeat.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bpm REAL,
    confidence REAL,
    stress_score REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/history", (req, res) => {
    const readings = db.prepare("SELECT * FROM readings ORDER BY timestamp DESC LIMIT 100").all();
    res.json(readings);
  });

  app.post("/api/readings", (req, res) => {
    const { bpm, confidence, stressScore } = req.body;
    if (bpm > 0) {
      db.prepare("INSERT INTO readings (bpm, confidence, stress_score) VALUES (?, ?, ?)").run(bpm, confidence, stressScore);
    }
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
