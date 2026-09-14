import type { SimConfig } from './worker';

export interface InspectTelemetry {
  agentIndex: number;
  tick: number;
  potentials: Float32Array; // length N
  spikes: Float32Array;     // length N (1.0 or 0.0)
  weights: Float32Array;    // length N * N
}

type FrameCallback = (agents: Float32Array, tick: number) => void;
type InspectCallback = (telemetry: InspectTelemetry | null) => void;

export class SimClient {
  private worker: Worker;
  private config: SimConfig;
  private _onFrame: FrameCallback | null = null;
  private _onInspect: InspectCallback | null = null;
  private alive = false;

  constructor(config: SimConfig) {
    this.config = config;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const arr = new Float32Array(e.data);
      const tick = arr[0];
      const inspectedIdx = arr[1];
      const spatialLength = this.config.agentCount * 3;
      const agents = arr.subarray(2, 2 + spatialLength);

      if (this._onFrame) this._onFrame(agents, tick);

      if (this._onInspect) {
        if (inspectedIdx >= 0) {
          const N = this.config.neuronsPerAgent;
          const offset = 2 + spatialLength;
          this._onInspect({
            agentIndex: inspectedIdx,
            tick,
            potentials: arr.subarray(offset, offset + N),
            spikes: arr.subarray(offset + N, offset + N * 2),
            weights: arr.subarray(offset + N * 2, offset + N * 2 + N * N),
          });
        } else {
          this._onInspect(null);
        }
      }
    };

    this.worker.onerror = (err) => console.error('[SimClient]', err.message, err);

    this.worker.postMessage({ type: 'init', config });
    this.alive = true;
  }

  set onFrame(cb: FrameCallback | null) { this._onFrame = cb; }
  set onInspect(cb: InspectCallback | null) { this._onInspect = cb; }

  start() { this.worker.postMessage({ type: 'resume' }); }
  pause() { this.worker.postMessage({ type: 'pause' }); }

  inspectAgent(agentIdx: number) {
    this.worker.postMessage({ type: 'inspect', agentIdx });
  }

  inject(agentIdx: number, neuronIdx: number, currentPA: number) {
    this.worker.postMessage({ type: 'inject', agentIdx, neuronIdx, i: currentPA });
  }

  setScent(x: number, y: number, idx = 0) {
    this.worker.postMessage({ type: 'setScentSource', idx, x, y });
  }

  destroy() {
    if (!this.alive) return;
    this.worker.postMessage({ type: 'pause' });
    this.worker.terminate();
    this.alive = false;
  }
}

