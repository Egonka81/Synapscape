// Leaky Integrate-and-Fire (LIF) Neural Network with Classical Spike-Timing-Dependent Plasticity (STDP)
// References:
//   - Gerstner et al. "Neuronal Dynamics" (2014), Chapter 1: LIF Model
//   - Bi & Poo (1998) "Synaptic Modifications in Cultured Hippocampal Neurons"
//   - Drosophila melanogaster antennal lobe & central complex sensorimotor topology

export interface LIFParameters {
  vRest: number;    // Resting membrane potential (mV) [-65.0]
  vThresh: number;  // Action potential threshold (mV) [-50.0]
  vReset: number;   // Post-spike reset potential (mV) [-70.0]
  tauM: number;     // Membrane time constant (ms) [20.0]
  rM: number;       // Membrane resistance (MΩ) [10.0]
  tRefrac: number;  // Absolute refractory duration (ms) [2.0]
  iScale: number;   // Scaling factor from input current (nA) to mV [1.0 -> 1 MΩ * 1 nA = 1 mV]
}

export const DEFAULT_LIF_PARAMS: LIFParameters = {
  vRest: -65.0,
  vThresh: -50.0,
  vReset: -70.0,
  tauM: 20.0,
  rM: 10.0,
  tRefrac: 2.0,
  iScale: 1.0,
};

export interface STDPParameters {
  tauPlus: number;   // LTP trace time constant (ms) [20.0]
  tauMinus: number;  // LTD trace time constant (ms) [20.0]
  aPlus: number;     // LTP learning amplitude [0.010]
  aMinus: number;    // LTD learning amplitude [0.012]
  wMin: number;      // Minimum synaptic weight [-20.0]
  wMax: number;      // Maximum synaptic weight [+20.0]
}

export const DEFAULT_STDP_PARAMS: STDPParameters = {
  tauPlus: 20.0,
  tauMinus: 20.0,
  aPlus: 0.010,
  aMinus: 0.012,
  wMin: -20.0,
  wMax: 20.0,
};

// Fixed 32-neuron topology indices
export const NeuronIndex = {
  // Olfactory sensory inputs (0..7)
  OLFACTORY_L_START: 0,
  OLFACTORY_L_END: 3,    // 4 neurons: L0..L3
  OLFACTORY_R_START: 4,
  OLFACTORY_R_END: 7,    // 4 neurons: R0..R3

  // Multi-directional collision sensory inputs (8..10)
  COL_FRONT: 8,
  COL_LEFT: 9,
  COL_RIGHT: 10,

  // Recurrent central complex interneurons (11..29) - 19 neurons
  INTER_START: 11,
  INTER_END: 29,

  // Motor outputs (30, 31)
  MOTOR_L: 30,
  MOTOR_R: 31,

  TOTAL: 32,
} as const;

const SLOTS = 4; // [0] v (mV), [1] refTimer (ms), [2] iExt (nA), [3] _pad

export class LIFNetwork {
  readonly n: number;
  readonly state: Float32Array;         // n * 4
  readonly weights: Float32Array;       // n * n
  readonly initialWeights: Float32Array;// n * n (snapshot of baseline weights)
  readonly plasticityMask: Uint8Array;  // n * n (0 = innate/hardwired, 1 = plastic)
  readonly spikes: Uint8Array;          // n (1 = fired this tick)

  // STDP trace buffers
  readonly preTrace: Float32Array;      // n
  readonly postTrace: Float32Array;     // n

  private readonly _iSyn: Float32Array;
  readonly lifParams: LIFParameters;
  readonly stdpParams: STDPParameters;

  constructor(
    n: number = NeuronIndex.TOTAL,
    buf?: ArrayBuffer,
    lifParams: LIFParameters = DEFAULT_LIF_PARAMS,
    stdpParams: STDPParameters = DEFAULT_STDP_PARAMS
  ) {
    this.n = n;
    this.lifParams = { ...lifParams };
    this.stdpParams = { ...stdpParams };

    const stateBytes = n * SLOTS * 4;
    const weightsBytes = n * n * 4;
    const maskBytes = n * n;

    if (buf) {
      let offset = 0;
      this.state = new Float32Array(buf, offset, n * SLOTS);
      offset += stateBytes;
      this.weights = new Float32Array(buf, offset, n * n);
      offset += weightsBytes;
      this.initialWeights = new Float32Array(buf, offset, n * n);
      offset += weightsBytes;
      this.plasticityMask = new Uint8Array(buf, offset, n * n);
      offset += maskBytes;
      this.spikes = new Uint8Array(buf, offset, n);
    } else {
      this.state = new Float32Array(n * SLOTS);
      this.weights = new Float32Array(n * n);
      this.initialWeights = new Float32Array(n * n);
      this.plasticityMask = new Uint8Array(n * n);
      this.spikes = new Uint8Array(n);
    }

    this.preTrace = new Float32Array(n);
    this.postTrace = new Float32Array(n);
    this._iSyn = new Float32Array(n);

    this.reset();
  }

  static bufferSize(n: number): number {
    return n * SLOTS * 4 + n * n * 4 * 2 + n * n + n;
  }

  reset() {
    const { vRest } = this.lifParams;
    for (let i = 0; i < this.n; i++) {
      this.state[i * SLOTS + 0] = vRest;
      this.state[i * SLOTS + 1] = 0.0;
      this.state[i * SLOTS + 2] = 0.0;
      this.state[i * SLOTS + 3] = 0.0;
    }
    this.spikes.fill(0);
    this.preTrace.fill(0.0);
    this.postTrace.fill(0.0);
    this._iSyn.fill(0.0);
  }

  // Pure deterministic Leaky Integrate-and-Fire simulation step
  // Equation: tau_m * dV/dt = -(V - V_rest) + R_m * I_total
  tick(dt: number) {
    const { n, state, weights, spikes, _iSyn, lifParams } = this;
    const { vRest, vThresh, vReset, tauM, rM, tRefrac, iScale } = lifParams;

    // 1. Synaptic current integration: I_syn[j] = sum_i (w_ij * spike_i)
    _iSyn.fill(0.0);
    for (let i = 0; i < n; i++) {
      if (!spikes[i]) continue;
      const row = i * n;
      for (let j = 0; j < n; j++) {
        _iSyn[j] += weights[row + j];
      }
    }

    // 2. Exponential decay of STDP traces
    const decayPre = Math.exp(-dt / this.stdpParams.tauPlus);
    const decayPost = Math.exp(-dt / this.stdpParams.tauMinus);
    for (let i = 0; i < n; i++) {
      this.preTrace[i] *= decayPre;
      this.postTrace[i] *= decayPost;
    }

    spikes.fill(0);
    const dtOverTau = dt / tauM;

    // 3. Sub-threshold membrane potential integration & threshold check
    for (let i = 0; i < n; i++) {
      const base = i * SLOTS;
      const ref = state[base + 1];

      // Refractory clamp
      if (ref > 0.0) {
        state[base + 1] = ref - dt < 0.0 ? 0.0 : ref - dt;
        state[base + 2] = 0.0;
        continue;
      }

      const v = state[base + 0];
      const iExt = state[base + 2];
      const iTot = iExt + _iSyn[i];

      // Physical voltage step: dV = (-(V - V_rest) + R_m * I) * (dt / tau_m)
      const vNew = v + dtOverTau * (-(v - vRest) + rM * iTot * iScale);

      if (vNew >= vThresh) {
        state[base + 0] = vReset;
        state[base + 1] = tRefrac;
        spikes[i] = 1;
        // On action potential: step both pre- and post-traces
        this.preTrace[i] += 1.0;
        this.postTrace[i] += 1.0;
      } else {
        state[base + 0] = vNew;
      }
      state[base + 2] = 0.0; // Clear transient external current
    }
  }

  // Inject current into a specific neuron (in nA)
  inject(neuronIdx: number, currentNA: number) {
    if (neuronIdx >= 0 && neuronIdx < this.n) {
      this.state[neuronIdx * SLOTS + 2] += currentNA;
    }
  }

  // Classical Spike-Timing Dependent Plasticity (Bi & Poo 1998)
  // LTP: pre fires before post -> strengthen w_ij
  // LTD: post fires before pre -> weaken w_ij
  // Only synapses with plasticityMask[ij] === 1 are modified.
  applySTDP() {
    const { n, weights, spikes, plasticityMask, preTrace, postTrace, stdpParams } = this;
    const { aPlus, aMinus, wMin, wMax } = stdpParams;

    for (let i = 0; i < n; i++) {
      const iFired = spikes[i];

      // 1. Post-synaptic spike: LTP on synapses incoming from pre-neurons that fired recently
      if (iFired) {
        // i is post-synaptic neuron
        for (let pre = 0; pre < n; pre++) {
          if (pre === i) continue;
          const idx = pre * n + i;
          if (plasticityMask[idx] === 1) {
            weights[idx] += aPlus * preTrace[pre];
            if (weights[idx] > wMax) weights[idx] = wMax;
            else if (weights[idx] < wMin) weights[idx] = wMin;
          }
        }

        // 2. Pre-synaptic spike: LTD on synapses outgoing to post-neurons that fired recently
        // i is pre-synaptic neuron
        for (let post = 0; post < n; post++) {
          if (post === i) continue;
          const idx = i * n + post;
          if (plasticityMask[idx] === 1) {
            weights[idx] -= aMinus * postTrace[post];
            if (weights[idx] > wMax) weights[idx] = wMax;
            else if (weights[idx] < wMin) weights[idx] = wMin;
          }
        }
      }
    }
  }

  // Setup innate Braitenberg tropotaxis and multi-directional collision avoidance reflexes
  // Hardwired connections are locked in plasticityMask (value 0).
  initChemotaxisWiring(strength = 8.0) {
    const { n, weights, plasticityMask, initialWeights } = this;
    const { MOTOR_L, MOTOR_R, COL_FRONT, COL_LEFT, COL_RIGHT } = NeuronIndex;

    // 1. Mark recurrent and forward interneuron synapses as PLASTIC (1)
    plasticityMask.fill(1);

    // Disable self-connections
    for (let i = 0; i < n; i++) {
      plasticityMask[i * n + i] = 0;
      weights[i * n + i] = 0.0;
    }

    // 2. Innate Braitenberg crossed chemotaxis (Antenna -> Motor)
    // Left olfactory (0..3) -> Right motor (31)
    for (let i = 0; i < 4; i++) {
      const idx = i * n + MOTOR_R;
      weights[idx] = strength;
      plasticityMask[idx] = 0; // HARDWIRED
    }
    // Right olfactory (4..7) -> Left motor (30)
    for (let i = 4; i < 8; i++) {
      const idx = i * n + MOTOR_L;
      weights[idx] = strength;
      plasticityMask[idx] = 0; // HARDWIRED
    }

    // 3. Innate Multi-Directional Collision Avoidance Reflexes
    // Front collision: Strong reverse / brake + rightward turn bias
    const fIdxL = COL_FRONT * n + MOTOR_L;
    const fIdxR = COL_FRONT * n + MOTOR_R;
    weights[fIdxL] = -strength * 1.5;
    weights[fIdxR] = -strength * 0.5;
    plasticityMask[fIdxL] = 0;
    plasticityMask[fIdxR] = 0;

    // Left collision: Accelerate left motor, brake right motor -> turn RIGHT away from obstacle
    const lIdxL = COL_LEFT * n + MOTOR_L;
    const lIdxR = COL_LEFT * n + MOTOR_R;
    weights[lIdxL] = strength * 0.8;
    weights[lIdxR] = -strength * 1.2;
    plasticityMask[lIdxL] = 0;
    plasticityMask[lIdxR] = 0;

    // Right collision: Brake left motor, accelerate right motor -> turn LEFT away from obstacle
    const rIdxL = COL_RIGHT * n + MOTOR_L;
    const rIdxR = COL_RIGHT * n + MOTOR_R;
    weights[rIdxL] = -strength * 1.2;
    weights[rIdxR] = strength * 0.8;
    plasticityMask[rIdxL] = 0;
    plasticityMask[rIdxR] = 0;

    // Snapshot innate baseline weights
    initialWeights.set(weights);
  }

  // Deterministic weight initialization using optional PRNG
  randomizeWeights(
    prng?: { next: () => number },
    excitRatio = 0.8,
    maxW = 5.0
  ) {
    const scale = maxW / Math.sqrt(this.n);
    const rng = prng ? () => prng.next() : Math.random;

    for (let i = 0; i < this.weights.length; i++) {
      // Only randomize synapses that are plastic
      if (this.plasticityMask[i] === 1) {
        const r = rng();
        this.weights[i] = r < excitRatio
          ? rng() * scale
          : -rng() * scale * 0.5;
      }
    }
    // Update baseline snapshot
    this.initialWeights.set(this.weights);
  }

  // Restore hardwired / innate weights if altered
  restoreInnateWeights() {
    for (let i = 0; i < this.plasticityMask.length; i++) {
      if (this.plasticityMask[i] === 0) {
        this.weights[i] = this.initialWeights[i];
      }
    }
  }
}
