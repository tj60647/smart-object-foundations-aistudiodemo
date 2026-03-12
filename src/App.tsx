import React, { useState, useEffect } from 'react';
import { HeartbeatMonitor } from './components/HeartbeatMonitor';
import { Heart, Activity, Brain, History, Info, AlertTriangle, TrendingUp, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HeartbeatReading, SignalState } from './types';

export default function App() {
  const [signal, setSignal] = useState<SignalState>({
    bpm: 0,
    confidence: 0,
    stressScore: 0,
    isConnected: false,
    status: "Not connected",
  });

  const [history, setHistory] = useState<HeartbeatReading[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.error("Failed to fetch history", err);
    }
  };

  const handleDataUpdate = async (bpm: number, confidence: number, stressScore: number) => {
    setSignal(prev => ({ ...prev, bpm, confidence, stressScore }));
    
    // Save to backend every few seconds or on significant change
    if (Math.random() > 0.95 && bpm > 0) {
      try {
        await fetch('/api/readings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bpm, confidence, stressScore }),
        });
        fetchHistory();
      } catch (err) {
        console.error("Failed to save reading", err);
      }
    }
  };

  const handleStatusChange = (isConnected: boolean, status: string) => {
    setSignal(prev => ({ ...prev, isConnected, status }));
  };

  const getStressLevel = (score: number) => {
    if (score < 30) return { label: 'Calm', color: 'text-emerald-400', bg: 'bg-emerald-400/10' };
    if (score < 60) return { label: 'Moderate', color: 'text-amber-400', bg: 'bg-amber-400/10' };
    return { label: 'High Stress', color: 'text-rose-400', bg: 'bg-rose-400/10' };
  };

  const stress = getStressLevel(signal.stressScore);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Activity className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">AURA</h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-semibold">Stress Monitor v1.0</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
              <div className={`w-2 h-2 rounded-full ${signal.isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-xs font-medium text-white/60">{signal.status}</span>
            </div>
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/60 hover:text-white"
            >
              <History size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Main Visualization */}
          <div className="lg:col-span-8 space-y-8">
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-white/40 flex items-center gap-2">
                  <Activity size={16} />
                  Live Biometric Stream
                </h2>
                <div className="text-[10px] font-mono text-white/20">500 SAMPLES @ 100HZ</div>
              </div>
              <HeartbeatMonitor 
                onDataUpdate={handleDataUpdate}
                onStatusChange={handleStatusChange}
              />
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white/40">Signal Confidence</h3>
                  <ShieldCheck size={16} className={signal.confidence > 0.7 ? 'text-emerald-400' : 'text-amber-400'} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-light">{(signal.confidence * 100).toFixed(0)}</span>
                  <span className="text-lg text-white/40">%</span>
                </div>
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    className={`h-full ${signal.confidence > 0.7 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${signal.confidence * 100}%` }}
                  />
                </div>
              </div>

              <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white/40">Heart Rate</h3>
                  <Heart size={16} className="text-rose-500 animate-pulse" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-light">{signal.bpm > 0 ? signal.bpm.toFixed(0) : '--'}</span>
                  <span className="text-lg text-white/40">BPM</span>
                </div>
                <p className="text-[10px] text-white/30 italic">Average resting: 60-100 BPM</p>
              </div>
            </div>
          </div>

          {/* Sidebar Stats */}
          <div className="lg:col-span-4 space-y-8">
            <section className={`p-8 rounded-3xl border border-white/10 transition-colors duration-500 ${stress.bg}`}>
              <div className="flex items-center gap-3 mb-8">
                <Brain className={stress.color} size={24} />
                <h2 className="text-sm font-bold uppercase tracking-widest opacity-60">Stress Analysis</h2>
              </div>

              <div className="space-y-6">
                <div>
                  <div className="text-6xl font-light tracking-tighter mb-2">
                    {signal.stressScore.toFixed(0)}
                  </div>
                  <div className={`text-xl font-medium ${stress.color}`}>
                    {stress.label}
                  </div>
                </div>

                <div className="pt-6 border-t border-white/10">
                  <p className="text-sm text-white/60 leading-relaxed">
                    {signal.stressScore < 30 
                      ? "Your heart rate variability and rhythm suggest a state of deep relaxation."
                      : signal.stressScore < 60
                      ? "Moderate physiological activity detected. Maintain steady breathing."
                      : "High physiological arousal detected. Consider a short mindfulness break."}
                  </p>
                </div>
              </div>
            </section>

            <section className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/40 mb-4 flex items-center gap-2">
                <Info size={14} />
                System Info
              </h3>
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

            <section className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/40 flex items-center gap-2">
                <TrendingUp size={14} />
                Biometric Insights
              </h3>
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-white/80 mb-1">Heart Rate (BPM)</h4>
                  <p className="text-[11px] text-white/50 leading-relaxed">
                    Beats Per Minute measures your heart's activity. A resting heart rate between 60-100 BPM is typical for adults. Lower rates often indicate better cardiovascular fitness.
                  </p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white/80 mb-1">Stress Analysis</h4>
                  <p className="text-[11px] text-white/50 leading-relaxed">
                    Our algorithm analyzes Heart Rate Variability (HRV) and rhythm stability. High stress scores often correlate with high BPM and irregular intervals, suggesting physiological arousal.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* History Overlay */}
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
                  <button onClick={() => setShowHistory(false)} className="text-white/40 hover:text-white">✕</button>
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
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-white/5 text-center">
        <p className="text-xs text-white/20 tracking-widest uppercase">
          Designed for Smart Object Foundations — MDes Prototyping
        </p>
      </footer>
    </div>
  );
}
