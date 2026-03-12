import React, { useEffect, useRef, useState } from 'react';
import { Activity, Heart, AlertCircle, CheckCircle2, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface HeartbeatMonitorProps {
  onDataUpdate: (bpm: number, confidence: number, stressScore: number) => void;
  onStatusChange: (connected: boolean, status: string) => void;
}

const SAMPLE_INTERVAL_MS = 10;
const BUFFER_SIZE = 500;
const BASELINE_N = 500;
const SMOOTH_N = 15;
const AMPLITUDE_THRESHOLD_DEFAULT = 80;
const MAX_PEAKS_STORED = 15;
const REFRACTORY_PERIOD_SAMPLES = 30; // 300ms at 100Hz (max 200 BPM)

export const HeartbeatMonitor: React.FC<HeartbeatMonitorProps> = ({ onDataUpdate, onStatusChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const keepReading = useRef<boolean>(true);
  
  // Signal Processing State (Refs for performance to avoid re-renders at 100Hz)
  const rawBuffer = useRef<number[]>(new Array(BUFFER_SIZE).fill(2047.5));
  const smoothedBuffer = useRef<number[]>(new Array(BUFFER_SIZE).fill(0));
  const baselineWindow = useRef<number[]>(new Array(BASELINE_N).fill(2047.5));
  const baselineSum = useRef<number>(BASELINE_N * 2047.5);
  const smoothWindow = useRef<number[]>([]);
  const prevSmoothed = useRef<number>(0);
  const prevSlope = useRef<number>(0);
  const sampleCount = useRef<number>(0);
  const peakSampleCounts = useRef<number[]>([]);
  const adaptiveThreshold = useRef<number>(AMPLITUDE_THRESHOLD_DEFAULT);
  const lastPeakSample = useRef<number>(0);

  const disconnectSerial = async () => {
    keepReading.current = false;
    if (readerRef.current) {
      await readerRef.current.cancel();
    }
    if (portRef.current) {
      await portRef.current.close();
      portRef.current = null;
    }
    onStatusChange(false, "Disconnected");
  };

  const connectSerial = async () => {
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      keepReading.current = true;

      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
      readerRef.current = decoder.readable.getReader();

      onStatusChange(true, "Connected");
      readLoop();
    } catch (err) {
      onStatusChange(false, "Connection failed. Please try again.");
      console.error(err);
    }
  };

  const readLoop = async () => {
    let partial = "";
    while (keepReading.current) {
      try {
        const { value, done } = await readerRef.current.read();
        if (done || !keepReading.current) {
          break;
        }
        partial += value;
        const lines = partial.split("\n");
        partial = lines.pop() || "";

        for (const line of lines) {
          const parts = line.trim().split(",");
          if (parts.length === 2) {
            const val = parseInt(parts[1]);
            if (!isNaN(val)) processSample(val);
          }
        }
      } catch (err) {
        if (keepReading.current) {
          onStatusChange(false, "Serial read error");
        }
        break;
      }
    }
  };

  const processSample = (raw: number) => {
    sampleCount.current++;
    
    // Raw Buffer
    rawBuffer.current.push(raw);
    rawBuffer.current.shift();

    // Step 1: Baseline Subtraction (High-pass filter effect)
    baselineSum.current -= baselineWindow.current.shift()!;
    baselineWindow.current.push(raw);
    baselineSum.current += raw;
    const dc = raw - baselineSum.current / BASELINE_N;

    // Step 2: Smoothing (Low-pass filter effect)
    smoothWindow.current.push(dc);
    if (smoothWindow.current.length > SMOOTH_N) smoothWindow.current.shift();
    const sm = smoothWindow.current.reduce((a, b) => a + b, 0) / smoothWindow.current.length;
    
    smoothedBuffer.current.push(sm);
    smoothedBuffer.current.shift();

    // Step 3: Differentiation
    const slope = sm - prevSmoothed.current;
    
    // Step 4: Improved Peak Detection (Adaptive Threshold + Refractory Period)
    const isPeakCandidate = prevSlope.current > 0 && slope <= 0;
    const timeSinceLastPeak = sampleCount.current - lastPeakSample.current;
    
    if (isPeakCandidate && sm > adaptiveThreshold.current && timeSinceLastPeak > REFRACTORY_PERIOD_SAMPLES) {
      peakSampleCounts.current.push(sampleCount.current);
      if (peakSampleCounts.current.length > MAX_PEAKS_STORED) peakSampleCounts.current.shift();
      
      // Update adaptive threshold (slowly track peak heights)
      adaptiveThreshold.current = adaptiveThreshold.current * 0.9 + sm * 0.1 * 0.6;
      // Ensure it doesn't drop too low or stay too high
      adaptiveThreshold.current = Math.max(AMPLITUDE_THRESHOLD_DEFAULT, Math.min(500, adaptiveThreshold.current));
      
      lastPeakSample.current = sampleCount.current;
      
      // Calculate Stats
      const stats = calculateStats();
      onDataUpdate(stats.bpm, stats.confidence, stats.stressScore);
    } else if (timeSinceLastPeak > 200) { // If no peak for 2 seconds, lower threshold
      adaptiveThreshold.current *= 0.99;
      adaptiveThreshold.current = Math.max(AMPLITUDE_THRESHOLD_DEFAULT, adaptiveThreshold.current);
    }

    prevSmoothed.current = sm;
    prevSlope.current = slope;
  };

  const calculateStats = () => {
    if (peakSampleCounts.current.length < 4) return { bpm: 0, confidence: 0, stressScore: 0 };

    const intervals = [];
    for (let i = 1; i < peakSampleCounts.current.length; i++) {
      intervals.push((peakSampleCounts.current[i] - peakSampleCounts.current[i - 1]) * SAMPLE_INTERVAL_MS);
    }

    // Filter outliers (e.g. double detections or missed beats)
    const median = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
    const filteredIntervals = intervals.filter(v => v > median * 0.5 && v < median * 1.5);
    
    if (filteredIntervals.length < 2) return { bpm: 0, confidence: 0, stressScore: 0 };

    const mean = filteredIntervals.reduce((a, b) => a + b, 0) / filteredIntervals.length;
    const bpm = 60000 / mean;
    
    const variance = filteredIntervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / filteredIntervals.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;
    
    // Confidence is higher when CV is lower (regular rhythm)
    const confidence = Math.max(0, Math.min(1, 1 - cv / 0.2));

    // Stress Score Calculation: Higher BPM + Lower HRV (CV) = Higher Stress
    // Normal resting BPM is 60-100.
    const bpmFactor = Math.min(1, Math.max(0, (bpm - 65) / 55)); // 0 at 65, 1 at 120
    const hrvFactor = Math.min(1, cv / 0.15); // Higher CV = Higher HRV = Lower Stress
    
    // Stress is high if BPM is high AND HRV is low
    const stressScore = (bpmFactor * 0.7 + (1 - hrvFactor) * 0.3) * 100;

    return { bpm, confidence, stressScore };
  };

  // Animation Loop for Canvas
  useEffect(() => {
    let animationFrameId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const halfH = h / 2;

      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, w, h);

      // Draw Grid
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 50) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
      }
      for (let i = 0; i < h; i += 50) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
      }

      // Draw Raw Waveform (Top) - Cyan
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < rawBuffer.current.length; i++) {
        const x = (i / (BUFFER_SIZE - 1)) * w;
        const y = ((rawBuffer.current[i] - 0) / (4095 - 0)) * (halfH - 40) + 20;
        if (i === 0) ctx.moveTo(x, halfH - y);
        else ctx.lineTo(x, halfH - y);
      }
      ctx.stroke();

      // Draw Smoothed Waveform (Bottom) - Amber
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < smoothedBuffer.current.length; i++) {
        const x = (i / (BUFFER_SIZE - 1)) * w;
        const y = ((smoothedBuffer.current[i] - (-400)) / (400 - (-400))) * (h - halfH - 40) + halfH + 20;
        if (i === 0) ctx.moveTo(x, h - (y - halfH) - halfH);
        else ctx.lineTo(x, h - (y - halfH) - halfH);
      }
      ctx.stroke();

      // Draw Adaptive Threshold Line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.setLineDash([5, 5]);
      const thresholdY = ((adaptiveThreshold.current - (-400)) / (400 - (-400))) * (h - halfH - 40) + halfH + 20;
      ctx.beginPath();
      ctx.moveTo(0, h - (thresholdY - halfH) - halfH);
      ctx.lineTo(w, h - (thresholdY - halfH) - halfH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Peaks - Rose
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2;
      peakSampleCounts.current.forEach(ps => {
        const samplesAgo = sampleCount.current - ps;
        if (samplesAgo >= 0 && samplesAgo < BUFFER_SIZE) {
          const x = ((BUFFER_SIZE - samplesAgo) / (BUFFER_SIZE - 1)) * w;
          ctx.beginPath();
          ctx.moveTo(x, halfH + 20);
          ctx.lineTo(x, h - 20);
          ctx.stroke();
          
          // Draw small heart icon at peak
          ctx.fillStyle = '#f43f5e';
          ctx.beginPath();
          ctx.arc(x, halfH + 20, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Divider
      ctx.strokeStyle = '#222';
      ctx.beginPath(); ctx.moveTo(0, halfH); ctx.lineTo(w, halfH); ctx.stroke();

      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => {
      cancelAnimationFrame(animationFrameId);
      if (portRef.current) {
        disconnectSerial();
      }
    };
  }, []);

  return (
    <div className="relative w-full bg-[#0a0a0a] rounded-2xl overflow-hidden border border-white/5 shadow-2xl group">
      <canvas 
        ref={canvasRef} 
        width={800} 
        height={400} 
        className="w-full h-auto block"
      />
      <div className="absolute top-4 left-4 flex gap-3">
        {!portRef.current ? (
          <button 
            onClick={connectSerial}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95"
          >
            <Zap size={18} fill="currentColor" />
            Connect Sensor
          </button>
        ) : (
          <button 
            onClick={disconnectSerial}
            className="px-5 py-2.5 bg-white/10 hover:bg-rose-600/20 hover:text-rose-400 text-white/80 rounded-xl font-semibold transition-all flex items-center gap-2 border border-white/10 active:scale-95"
          >
            <Activity size={18} />
            Disconnect
          </button>
        )}
      </div>
      
      <div className="absolute bottom-4 right-4 flex items-center gap-4 text-[10px] font-mono text-white/20 uppercase tracking-widest">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-cyan-400" />
          Raw Signal
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          Filtered
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-rose-400" />
          Beats
        </div>
      </div>
    </div>
  );
};
