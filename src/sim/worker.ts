// Web Worker – Deterministic Fixed-Timestep 60 Hz Simulation Engine
// Zero-Allocation Transferable ArrayBuffer Recycling Pipeline
//
// Message Protocol (Main Thread -> Worker):
//   { type: 'init', config: SimConfig }
//   { type: 'pause' } / { type: 'resume' }
//   { type: 'inspect', agentIdx: number }
//   { type: 'inject', agentIdx, neuronIdx, i }
//   { type: 'setScentSource', idx, x, y }
//   { type: 'recycle_frame', buffer: ArrayBuffer }
//   { type: 'recycle_phero', buffer: ArrayBuffer }
//
// Worker -> Main Thread:
//   { type: 'frame', buffer: ArrayBuffer, metrics: SimMetrics }
//   { type: 'pheromone', buffer: ArrayBuffer }

import { LIFNetwork, NeuronIndex } from './lif';
import { AgentPool, AgentSlot, SENSOR_CHANNELS } from './agent';
import { PheromoneGrid } from './pheromone';
import { PRNG } from './prng';

export { PRNG };

export interface SimConfig {
  agentCount: number;
  neuronsPerAgent: number;
  worldW: number;
  worldH: number;
  scentSources: number[];
  obstacles: number[];
  stdpEveryNTicks?: number;
  seed?: number;
  enableSTDP?: boolean;
}

export interface SimMetrics {
  tick: number;
  totalSpikes: number;
  avgSpikeRateHz: number;
  avgMembranePotential: number;
  meanSynapticWeight: number;
  meanAbsWeight: number;
  potentiatedSynapses: number;
  depressedSynapses: number;
  meanDistanceToTarget: number;
  totalCollisions: number;
  targetAcquisitionRate: number;
}

const HEADER     = 2; // [tick, inspectedAgentIdx]
const PER_AGENT  = 3; // [x, y, angle]
const SIM_DT     = 1000 / 60; // 16.6666667 ms fixed physical timestep
const MAX_STEPS  = 5;         // Max simulation steps per scheduling tick to avoid death spiral
const RING_TICKS = 120;       // 120-tick spike history for raster plot

let prng: PRNG;
let nets: LIFNetwork[] = [];
let pool: AgentPool | null = null;
let pheromoneGrid: PheromoneGrid | null = null;
let cfg: SimConfig;
let scentSrc: Float32Array;
let obstacleArr: Float32Array;

// Spike history ring buffers for inspected agent [RING_TICKS * N]
let spikeHistoryBuffers: Uint8Array[] = [];
let historyHead = 0;

// Reusable zero-allocation ArrayBuffer pools
const frameBufferPool: ArrayBuffer[] = [];
const pheroBufferPool: ArrayBuffer[] = [];

let inspectedAgent = -1;
let running        = false;
let lastTime       = 0;
let accumulator    = 0;
let tickCount      = 0;
let timerId        = 0;

// Metrics accumulator
let totalSpikesAcc = 0;

function step(dt: number) {
  if (!pool) return;

  const { agentCount, worldW, worldH, stdpEveryNTicks = 1, enableSTDP = true } = cfg;
  const doSTDP = enableSTDP && (tickCount % stdpEveryNTicks === 0);
  const numSources = (scentSrc.length / 2) | 0;
  const numObs     = (obstacleArr.length / 3) | 0;
  const targetX    = scentSrc[0] ?? worldW / 2;
  const targetY    = scentSrc[1] ?? worldH / 2;

  tickCount++;
  let tickSpikes = 0;
  let totalPotentials = 0;
  let totalDistanceToTarget = 0;
  let acquiredCount = 0;

  for (let a = 0; a < agentCount; a++) {
    const net = nets[a];
    const b   = a * AgentSlot._COUNT;
    const ax  = pool.buf[b + AgentSlot.X];
    const ay  = pool.buf[b + AgentSlot.Y];

    // Track distance to primary food plume
    const dx = ax - targetX;
    const dy = ay - targetY;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);
    totalDistanceToTarget += distToTarget;

    if (distToTarget < 30.0) {
      pool.targetAcquired[a] = 1;
      acquiredCount++;
    }

    // Pheromone emission within food / reward plume zone
    if (pheromoneGrid && distToTarget < 120.0) {
      pheromoneGrid.deposit(ax, ay, 0.8);
    }

    // 1. Olfactory & Pheromone sensing (channels 0..7)
    pool.readOlfactorySensors(a, scentSrc, numSources, pheromoneGrid ?? undefined);

    // 2. Multi-directional collision detection (channels 8, 9, 10)
    pool.checkCollision(a, obstacleArr, numObs);

    // 3. Inject sensory signals into LIF network
    const sb = a * SENSOR_CHANNELS;
    // Olfactory receptors (0..7): input in [0, 1] scaled to 2.0 nA (20 mV depolarization)
    for (let s = 0; s < 8; s++) {
      const sig = pool.sensorOut[sb + s];
      if (sig > 0.01) net.inject(s, sig * 2.0);
    }
    // Collision receptors (8, 9, 10): 3.0 nA (30 mV depolarization -> immediate action potential)
    for (let s = 8; s < 11; s++) {
      const sig = pool.sensorOut[sb + s];
      if (sig > 0.5) net.inject(s, 3.0);
    }

    // 4. Deterministic physical LIF integration step
    net.tick(dt);
    if (doSTDP) net.applySTDP();

    // Accumulate spikes & membrane potentials for scientific metrics
    const N = net.n;
    for (let i = 0; i < N; i++) {
      if (net.spikes[i]) tickSpikes++;
      totalPotentials += net.state[i * 4];
    }

    // Update inspected agent's spike raster ring buffer
    if (a === inspectedAgent && spikeHistoryBuffers[a]) {
      const hist = spikeHistoryBuffers[a];
      const offset = historyHead * N;
      hist.set(net.spikes, offset);
    }

    // 5. Motor actuation & kinematic translation
    const motorL = NeuronIndex.MOTOR_L;
    const motorR = NeuronIndex.MOTOR_R;
    const spikeL = net.spikes[motorL];
    const spikeR = net.spikes[motorR];
    pool.applyMotor(a, spikeL ? 1.0 : -0.1, spikeR ? 1.0 : -0.1);
    pool.tick(a, dt, worldW, worldH);
  }

  historyHead = (historyHead + 1) % RING_TICKS;
  totalSpikesAcc += tickSpikes;

  // 6. Cellular Automata Pheromone Diffusion & Evaporation Step
  if (pheromoneGrid) {
    pheromoneGrid.step();

    // Broadcast 90x60 grid intensities to main thread every 2 ticks (~30 Hz)
    if (tickCount % 2 === 0) {
      const totalBytes = pheromoneGrid.totalCells;
      let rawPhero = pheroBufferPool.pop();
      if (!rawPhero || rawPhero.byteLength !== totalBytes) {
        rawPhero = new ArrayBuffer(totalBytes);
      }
      const pheroBytes = new Uint8Array(rawPhero);
      pheromoneGrid.exportUint8(pheroBytes);

      (self as unknown as Worker).postMessage(
        { type: 'pheromone', buffer: rawPhero },
        [rawPhero]
      );
    }
  }

  // 7. Compute Global Scientific & Learning Telemetry
  const totalNeurons = agentCount * cfg.neuronsPerAgent;
  let sumWeights = 0;
  let sumAbsWeights = 0;
  let potentiated = 0;
  let depressed = 0;
  let totalSynapses = 0;
  let totalCollisions = 0;

  for (let a = 0; a < agentCount; a++) {
    totalCollisions += pool.collisionCount[a];
    const net = nets[a];
    const wLen = net.weights.length;
    totalSynapses += wLen;
    for (let i = 0; i < wLen; i++) {
      const w = net.weights[i];
      const w0 = net.initialWeights[i];
      sumWeights += w;
      sumAbsWeights += Math.abs(w);
      if (w > w0 + 0.05) potentiated++;
      else if (w < w0 - 0.05) depressed++;
    }
  }

  const metrics: SimMetrics = {
    tick: tickCount,
    totalSpikes: totalSpikesAcc,
    avgSpikeRateHz: (tickSpikes / (totalNeurons * (dt * 0.001))),
    avgMembranePotential: totalPotentials / totalNeurons,
    meanSynapticWeight: sumWeights / totalSynapses,
    meanAbsWeight: sumAbsWeights / totalSynapses,
    potentiatedSynapses: potentiated,
    depressedSynapses: depressed,
    meanDistanceToTarget: totalDistanceToTarget / agentCount,
    totalCollisions,
    targetAcquisitionRate: acquiredCount / agentCount,
  };

  // 8. Serialize Frame State into Recycled Zero-Allocation Buffer
  const isInspecting = inspectedAgent >= 0 && inspectedAgent < agentCount;
  const N = cfg.neuronsPerAgent;
  // Extra inspection payload: potentials (N) + spikes (N) + weights (N^2) + initialWeights (N^2) + spikeHistory (RING_TICKS * N)
  const inspectExtra = isInspecting ? (N + N + N * N + N * N + RING_TICKS * N) : 0;
  const spatialEnd = HEADER + agentCount * PER_AGENT;
  const totalFloats = spatialEnd + inspectExtra;
  const byteLength = totalFloats * 4;

  let rawFrame = frameBufferPool.pop();
  if (!rawFrame || rawFrame.byteLength !== byteLength) {
    rawFrame = new ArrayBuffer(byteLength);
  }
  const out = new Float32Array(rawFrame);

  out[0] = tickCount;
  out[1] = isInspecting ? inspectedAgent : -1;

  for (let a = 0; a < agentCount; a++) {
    const b  = a * AgentSlot._COUNT;
    const ob = HEADER + a * PER_AGENT;
    out[ob]     = pool.buf[b + AgentSlot.X];
    out[ob + 1] = pool.buf[b + AgentSlot.Y];
    out[ob + 2] = pool.buf[b + AgentSlot.Angle];
  }

  if (isInspecting) {
    const net = nets[inspectedAgent];
    if (net) {
      let offset = spatialEnd;
      // Membrane potentials
      for (let i = 0; i < N; i++) {
        out[offset + i] = net.state[i * 4];
      }
      offset += N;
      // Current spikes
      for (let i = 0; i < N; i++) {
        out[offset + i] = net.spikes[i];
      }
      offset += N;
      // Synaptic weights
      out.set(net.weights, offset);
      offset += N * N;
      // Initial baseline weights
      out.set(net.initialWeights, offset);
      offset += N * N;
      // Spike history ring buffer
      const hist = spikeHistoryBuffers[inspectedAgent];
      if (hist) {
        for (let i = 0; i < hist.length; i++) {
          out[offset + i] = hist[i];
        }
      }
    }
  }

  // Zero-copy transfer to main thread
  (self as unknown as Worker).postMessage(
    { type: 'frame', buffer: rawFrame, metrics },
    [rawFrame]
  );
}

// Fixed-timestep scheduler loop with accumulator
function loop() {
  if (!running || !pool) return;

  try {
    const now = performance.now();
    if (lastTime === 0) lastTime = now;
    const elapsed = now - lastTime;
    lastTime = now;

    accumulator += elapsed;
    // Cap accumulator to avoid death spiral when browser tab is inactive
    if (accumulator > SIM_DT * MAX_STEPS * 2) {
      accumulator = SIM_DT * MAX_STEPS;
    }

    let steps = 0;
    while (accumulator >= SIM_DT && steps < MAX_STEPS) {
      step(SIM_DT);
      accumulator -= SIM_DT;
      steps++;
    }
  } catch (err) {
    console.error('[Worker loop exception]:', err);
  } finally {
    if (running) {
      // Schedule at ~120 Hz to ensure smooth accumulator drainage
      timerId = self.setTimeout(loop, 1000 / 120) as unknown as number;
    }
  }
}

if (typeof self !== 'undefined') {
  self.onmessage = (e: MessageEvent) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'init') {
      try {
        cfg = msg.config as SimConfig;
        const { agentCount, neuronsPerAgent, worldW, worldH, seed = 42 } = cfg;

        prng = new PRNG(seed);

        scentSrc = cfg.scentSources && cfg.scentSources.length
          ? new Float32Array(cfg.scentSources)
          : new Float32Array([worldW / 2, worldH / 2]);

        obstacleArr = cfg.obstacles && cfg.obstacles.length
          ? new Float32Array(cfg.obstacles)
          : new Float32Array([0, 0, 0]);

        pool = new AgentPool(agentCount);
        pool.odorField.setSourcesFromFlat(scentSrc);
        pheromoneGrid = new PheromoneGrid(worldW, worldH, 10, 0.12, 0.015);

        nets = [];
        spikeHistoryBuffers = [];
        for (let a = 0; a < agentCount; a++) {
          const net = new LIFNetwork(neuronsPerAgent);
          net.initChemotaxisWiring();
          net.randomizeWeights(prng);
          net.initChemotaxisWiring(); // lock innate wiring
          nets.push(net);

          spikeHistoryBuffers.push(new Uint8Array(RING_TICKS * neuronsPerAgent));

          pool.spawn(
            a,
            prng.next() * worldW,
            prng.next() * worldH,
            prng.next() * Math.PI * 2
          );
        }

        running        = true;
        lastTime       = 0;
        accumulator    = 0;
        tickCount      = 0;
        totalSpikesAcc = 0;
        historyHead    = 0;
        clearTimeout(timerId);
        timerId = self.setTimeout(loop, 0) as unknown as number;
      } catch (err) {
        console.error('[Worker init exception]:', err);
      }
      return;
    }

    // Buffer recycling handlers (Zero-allocation Transferable pool)
    if (msg.type === 'recycle_frame') {
      if (msg.buffer instanceof ArrayBuffer && frameBufferPool.length < 5) {
        frameBufferPool.push(msg.buffer);
      }
      return;
    }

    if (msg.type === 'recycle_phero') {
      if (msg.buffer instanceof ArrayBuffer && pheroBufferPool.length < 5) {
        pheroBufferPool.push(msg.buffer);
      }
      return;
    }

    if (msg.type === 'pause') {
      running = false;
      clearTimeout(timerId);
      return;
    }

    if (msg.type === 'resume') {
      if (!running) {
        running = true;
        lastTime = 0;
        accumulator = 0;
        timerId = self.setTimeout(loop, 0) as unknown as number;
      }
      return;
    }

    if (msg.type === 'inspect') {
      inspectedAgent = typeof msg.agentIdx === 'number' ? msg.agentIdx : -1;
      return;
    }

    if (msg.type === 'inject') {
      nets[msg.agentIdx]?.inject(msg.neuronIdx, msg.i);
      return;
    }

    if (msg.type === 'setScentSource') {
      const base = (msg.idx as number) * 2;
      if (base + 1 < scentSrc.length) {
        scentSrc[base] = msg.x;
        scentSrc[base + 1] = msg.y;
        pool?.odorField.setSourcesFromFlat(scentSrc);
      }
      return;
    }
  };
}
