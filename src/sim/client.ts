import type { SimConfig } from './worker';

type FrameCallback = (agents: Float32Array, tick: number) => void;

export class SimClient {
  private worker: Worker;
  private _onFrame: FrameCallback | null = null;
  private alive = false;

  constructor(config: SimConfig) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const arr = new Float32Array(e.data);
      if (this._onFrame) this._onFrame(arr.subarray(1), arr[0]);
    };

    this.worker.onerror = (err) => console.error('[SimClient]', err.message, err);

    this.worker.postMessage({ type: 'init', config });
    this.alive = true;
  }

  set onFrame(cb: FrameCallback | null) { this._onFrame = cb; }

  start() { this.worker.postMessage({ type: 'resume' }); }
  pause() { this.worker.postMessage({ type: 'pause' }); }

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
