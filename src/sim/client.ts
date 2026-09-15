import type { SimConfig, SimMetrics } from './worker';

export type { SimConfig, SimMetrics };

export interface InspectTelemetry {
  agentIndex: number;
  tick: number;
  potentials: Float32Array;    // length N
  spikes: Float32Array;        // length N (1.0 or 0.0)
  weights: Float32Array;       // length N * N
  initialWeights: Float32Array;// length N * N
  spikeHistory: Float32Array;  // length 120 * N
}

type FrameCallback = (agents: Float32Array, tick: number) => void;
type InspectCallback = (telemetry: InspectTelemetry | null) => void;
type PheromoneCallback = (data: Uint8Array) => void;
type MetricsCallback = (metrics: SimMetrics) => void;

export class SimClient {
  private worker: Worker;
  private config: SimConfig;
  private _onFrame: FrameCallback | null = null;
  private _onInspect: InspectCallback | null = null;
  private _onPheromone: PheromoneCallback | null = null;
  private _onMetrics: MetricsCallback | null = null;
  private alive = false;

  // Double-buffering retention for safe zero-copy transferable recycling
  private previousFrameBuffer: ArrayBuffer | null = null;
  private previousPheroBuffer: ArrayBuffer | null = null;

  constructor(config: SimConfig) {
    this.config = config;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data) return;

      // 1. Direct ArrayBuffer message (legacy or direct transfer)
      if (data instanceof ArrayBuffer) {
        this.unpackFrame(data);
        return;
      }

      // 2. Direct TypedArray transfer
      if (ArrayBuffer.isView(data)) {
        this.unpackFrame(data.buffer as ArrayBuffer);
        return;
      }

      // 3. Structured object message protocol ({ type: 'frame' | 'pheromone', buffer | data, metrics })
      if (typeof data === 'object') {
        const msg = data as {
          type?: string;
          buffer?: ArrayBuffer;
          data?: ArrayBuffer;
          agents?: Float32Array;
          tick?: number;
          pheromones?: Uint8Array | ArrayBuffer;
          metrics?: SimMetrics;
        };

        if (msg.type === 'frame') {
          if (msg.metrics && this._onMetrics) {
            this._onMetrics(msg.metrics);
          }

          const raw = msg.buffer ?? msg.data;
          if (raw instanceof ArrayBuffer) {
            this.unpackFrame(raw);
          } else if (msg.agents instanceof Float32Array) {
            if (this._onFrame) {
              this._onFrame(msg.agents, typeof msg.tick === 'number' ? msg.tick : 0);
            }
          }
          return;
        }

        if (msg.type === 'pheromone') {
          const raw = msg.buffer ?? msg.data ?? msg.pheromones;
          if (raw) {
            let pheroBytes: Uint8Array;
            let recycleBuf: ArrayBuffer | null = null;

            if (raw instanceof ArrayBuffer) {
              pheroBytes = new Uint8Array(raw);
              recycleBuf = raw;
            } else if (raw instanceof Uint8Array) {
              pheroBytes = raw;
              recycleBuf = raw.buffer as ArrayBuffer;
            } else {
              return;
            }

            if (this._onPheromone) {
              this._onPheromone(pheroBytes);
            }

            // Recycle previous pheromone buffer to worker
            if (this.previousPheroBuffer && this.previousPheroBuffer.byteLength > 0) {
              this.worker.postMessage({ type: 'recycle_phero', buffer: this.previousPheroBuffer }, [this.previousPheroBuffer]);
            }
            this.previousPheroBuffer = recycleBuf;
          }
          return;
        }
      }
    };

    this.worker.onerror = (err) => console.error('[SimClient worker error]:', err.message, err);

    this.worker.postMessage({ type: 'init', config });
    this.alive = true;
  }

  private unpackFrame(buffer: ArrayBuffer) {
    const arr = new Float32Array(buffer);
    const tick = arr[0];
    const inspectedIdx = arr[1];
    const spatialLength = this.config.agentCount * 3;
    const agents = arr.subarray(2, 2 + spatialLength);

    if (this._onFrame) {
      this._onFrame(agents, tick);
    }

    if (this._onInspect) {
      if (inspectedIdx >= 0) {
        const N = this.config.neuronsPerAgent;
        const offset = 2 + spatialLength;
        const RING_TICKS = 120;
        this._onInspect({
          agentIndex: inspectedIdx,
          tick,
          potentials: arr.subarray(offset, offset + N),
          spikes: arr.subarray(offset + N, offset + N * 2),
          weights: arr.subarray(offset + N * 2, offset + N * 2 + N * N),
          initialWeights: arr.subarray(offset + N * 2 + N * N, offset + N * 2 + N * N * 2),
          spikeHistory: arr.subarray(offset + N * 2 + N * N * 2, offset + N * 2 + N * N * 2 + RING_TICKS * N),
        });
      } else {
        this._onInspect(null);
      }
    }

    // Ping-pong buffer recycling: return previous frame buffer once this frame is in active view
    if (this.previousFrameBuffer && this.previousFrameBuffer.byteLength > 0) {
      this.worker.postMessage({ type: 'recycle_frame', buffer: this.previousFrameBuffer }, [this.previousFrameBuffer]);
    }
    this.previousFrameBuffer = buffer;
  }

  set onFrame(cb: FrameCallback | null) { this._onFrame = cb; }
  set onInspect(cb: InspectCallback | null) { this._onInspect = cb; }
  set onPheromone(cb: PheromoneCallback | null) { this._onPheromone = cb; }
  set onMetrics(cb: MetricsCallback | null) { this._onMetrics = cb; }

  start() { this.worker.postMessage({ type: 'resume' }); }
  pause() { this.worker.postMessage({ type: 'pause' }); }

  inspectAgent(agentIdx: number) {
    this.worker.postMessage({ type: 'inspect', agentIdx });
  }

  inject(agentIdx: number, neuronIdx: number, currentNA: number) {
    this.worker.postMessage({ type: 'inject', agentIdx, neuronIdx, i: currentNA });
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
