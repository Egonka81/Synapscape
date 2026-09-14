// Leaky Integrate-and-Fire neuronháló
// Referencia: Gerstner et al. "Neuronal Dynamics" (2014), 1. fejezet
//
// Memória-elrendezés (minden neuronhoz 4 float32 slot):
//   [0] v        – membránpotenciál (mV)
//   [1] refTimer – hátralévő refrakter idő (ms)
//   [2] iExt     – külső injekált áram (pA), nullázandó tick után
//   [3] _pad     – jövőbeli használatra (4-es igazítás)

const SLOTS = 4;

const V_REST   = -65.0;  // mV
const V_THRESH = -50.0;  // mV
const V_RESET  = -70.0;  // mV
const TAU_M    =  20.0;  // ms
const R_M      =  10.0;  // MΩ
const T_REFRAC =   2.0;  // ms

export class LIFNetwork {
  readonly n: number;
  readonly state: Float32Array;
  readonly weights: Float32Array;
  readonly spikes: Uint8Array;

  private readonly _iSyn: Float32Array;

  constructor(n: number, buf?: ArrayBuffer) {
    this.n = n;
    const stateBytes   = n * SLOTS * 4;
    const weightsBytes = n * n * 4;

    if (buf) {
      this.state   = new Float32Array(buf, 0, n * SLOTS);
      this.weights = new Float32Array(buf, stateBytes, n * n);
      this.spikes  = new Uint8Array(buf, stateBytes + weightsBytes, n);
    } else {
      this.state   = new Float32Array(n * SLOTS);
      this.weights = new Float32Array(n * n);
      this.spikes  = new Uint8Array(n);
    }

    this._iSyn = new Float32Array(n);
    this.reset();
  }

  static bufferSize(n: number): number {
    return n * SLOTS * 4 + n * n * 4 + n;
  }

  reset() {
    for (let i = 0; i < this.n; i++) {
      this.state[i * SLOTS + 0] = V_REST;
      this.state[i * SLOTS + 1] = 0.0;
      this.state[i * SLOTS + 2] = 0.0;
      this.state[i * SLOTS + 3] = 0.0;
    }
    this.spikes.fill(0);
  }

  tick(dt: number) {
    const { n, state, weights, spikes, _iSyn } = this;

    _iSyn.fill(0.0);
    for (let i = 0; i < n; i++) {
      if (!spikes[i]) continue;
      const row = i * n;
      for (let j = 0; j < n; j++) {
        _iSyn[j] += weights[row + j];
      }
    }

    spikes.fill(0);
    const dtOverTau = dt / TAU_M;

    for (let i = 0; i < n; i++) {
      const base = i * SLOTS;
      const ref  = state[base + 1];

      if (ref > 0.0) {
        state[base + 1] = ref - dt < 0.0 ? 0.0 : ref - dt;
        state[base + 2] = 0.0;
        continue;
      }

      const v    = state[base + 0];
      const iTot = state[base + 2] + _iSyn[i];

      // dv/dt = (-(v - V_REST) + R_M * I) / TAU_M
      const vNew = v + dtOverTau * (-(v - V_REST) + R_M * iTot);

      if (vNew >= V_THRESH) {
        state[base + 0] = V_RESET;
        state[base + 1] = T_REFRAC;
        spikes[i] = 1;
      } else {
        state[base + 0] = vNew;
      }
      state[base + 2] = 0.0;
    }
  }

  inject(neuronIdx: number, currentPA: number) {
    this.state[neuronIdx * SLOTS + 2] += currentPA;
  }

  // Braitenberg-kemotaxis bekötés: keresztezett antenna→motor kapcsolatok
  // Bal antenna (0-3) → jobb motor (n-1); jobb antenna (4-7) → bal motor (n-2)
  // Az ütközési neuron (8) mindkét motort gátolja → hátrálás/fordulás reflex
  // A randomizeWeights() hívása ELŐTT kell meghívni, mert azt felülírja.
  initChemotaxisWiring(strength = 8.0) {
    const { n, weights } = this;
    const motorL = n - 2;
    const motorR = n - 1;

    for (let i = 0; i < 4; i++) weights[i * n + motorR] = strength;
    for (let i = 4; i < 8; i++) weights[i * n + motorL] = strength;
    // Aszimmetria → fordulás jobbra ütközéskor
    weights[8 * n + motorL] = -strength * 1.5;
    weights[8 * n + motorR] = -strength * 0.5;
  }

  randomizeWeights(excitRatio = 0.8, maxW = 5.0) {
    const scale = maxW / Math.sqrt(this.n);
    for (let i = 0; i < this.weights.length; i++) {
      const r = Math.random();
      this.weights[i] = r < excitRatio
        ? Math.random() * scale
        : -Math.random() * scale * 0.5;
    }
  }

  // Spike-Timing Dependent Plasticity – Bi & Poo (1998)
  applySTDP(learningRate = 0.01, aPlus = 0.01, aMinus = 0.012) {
    const { n, weights, spikes } = this;
    for (let pre = 0; pre < n; pre++) {
      for (let post = 0; post < n; post++) {
        if (pre === post) continue;
        const idx = pre * n + post;
        if (spikes[pre] && spikes[post]) {
          weights[idx] += learningRate * aPlus;
        } else if (spikes[pre]) {
          weights[idx] -= learningRate * aMinus;
        }
        if (weights[idx] >  20.0) weights[idx] =  20.0;
        if (weights[idx] < -20.0) weights[idx] = -20.0;
      }
    }
  }
}
