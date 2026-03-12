export interface HeartbeatReading {
  id: number;
  bpm: number;
  confidence: number;
  stress_score: number;
  timestamp: string;
}

export interface SignalState {
  bpm: number;
  confidence: number;
  stressScore: number;
  isConnected: boolean;
  status: string;
}
