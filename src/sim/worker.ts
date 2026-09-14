// Web Worker – 60 Hz-es szimuláció motor
//
// Üzenet protokoll (főszál → Worker):
//   { type: 'init', config: SimConfig }
//   { type: 'pause' } / { type: 'resume' }
//   { type: 'inject', agentIdx, neuronIdx, i }
//   { type: 'setScentSource', idx, x, y }
//
// Worker → főszál (Transferable Float32Array):
//   [tick, x0, y0, angle0, x1, y1, angle1, ...]

import { LIFNetwork } from './lif';
import { AgentPool, AgentSlot } from './agent';

export interface SimConfig {
  agentCount: number;
  neuronsPerAgent: number;
  worldW: number;
  worldH: number;
  scentSources: number[];
  obstacles: number[];
  stdpEveryNTicks?: number;
}

const HEADER    = 1;
const PER_AGENT = 3; // x, y, angle
const TICK_MS   = 1000 / 60;

let nets: LIFNetwork[] = [];
let pool: AgentPool | null = null;
let cfg: SimConfig;
let scentSrc: Float32Array;
let obstacleArr: Float32Array;

let running   = false;
let lastTime  = 0;
let tickCount = 0;
let timerId   = 0;

function step() {
  if (!running || !pool) return;

  const now = performance.now();
  const dt  = lastTime === 0 ? TICK_MS : now - lastTime;
  lastTime  = now;
  tickCount++;

  const { agentCount, worldW, worldH, stdpEveryNTicks = 10 } = cfg;
  const doSTDP = tickCount % stdpEveryNTicks === 0;
  const numSources = (scentSrc.length / 2) | 0;
  const numObs     = (obstacleArr.length / 3) | 0;

  for (let a = 0; a < agentCount; a++) {
    const net = nets[a];

    pool.readOlfactorySensors(a, scentSrc, numSources);
    pool.checkCollision(a, obstacleArr, numObs);

    const sb = a * 9;
    for (let s = 0; s < 9; s++) {
      const sig = pool.sensorOut[sb + s];
      if (sig > 0.01) net.inject(s, sig * 50.0);
    }

    net.tick(dt);
    if (doSTDP) net.applySTDP();

    const n      = net.n;
    const spikeL = net.spikes[n - 2];
    const spikeR = net.spikes[n - 1];
    pool.applyMotor(a, spikeL ? 1.0 : -0.1, spikeR ? 1.0 : -0.1);
    pool.tick(a, dt, worldW, worldH);
  }

  const out = new Float32Array(HEADER + agentCount * PER_AGENT);
  out[0] = tickCount;
  for (let a = 0; a < agentCount; a++) {
    const b  = a * AgentSlot._COUNT;
    const ob = HEADER + a * PER_AGENT;
    out[ob]     = pool.buf[b + AgentSlot.X];
    out[ob + 1] = pool.buf[b + AgentSlot.Y];
    out[ob + 2] = pool.buf[b + AgentSlot.Angle];
  }

  (self as unknown as Worker).postMessage(out, [out.buffer]);

  timerId = self.setTimeout(step, TICK_MS) as unknown as number;
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    cfg = msg.config as SimConfig;
    const { agentCount, neuronsPerAgent, worldW, worldH } = cfg;

    scentSrc    = new Float32Array(cfg.scentSources);
    obstacleArr = cfg.obstacles.length
      ? new Float32Array(cfg.obstacles)
      : new Float32Array([0, 0, 0]);

    pool = new AgentPool(agentCount);
    nets = [];

    for (let a = 0; a < agentCount; a++) {
      const net = new LIFNetwork(neuronsPerAgent);
      net.initChemotaxisWiring();
      net.randomizeWeights();
      net.initChemotaxisWiring(); // randomize felülírja, visszaállítjuk
      nets.push(net);
      pool.spawn(a, Math.random() * worldW, Math.random() * worldH, Math.random() * Math.PI * 2);
    }

    running  = true;
    lastTime = 0;
    timerId  = self.setTimeout(step, 0) as unknown as number;
    return;
  }

  if (msg.type === 'pause')  { running = false; clearTimeout(timerId); return; }

  if (msg.type === 'resume') {
    if (!running) { running = true; lastTime = 0; timerId = self.setTimeout(step, 0) as unknown as number; }
    return;
  }

  if (msg.type === 'inject') { nets[msg.agentIdx]?.inject(msg.neuronIdx, msg.i); return; }

  if (msg.type === 'setScentSource') {
    const base = (msg.idx as number) * 2;
    if (base + 1 < scentSrc.length) { scentSrc[base] = msg.x; scentSrc[base + 1] = msg.y; }
    return;
  }
};
