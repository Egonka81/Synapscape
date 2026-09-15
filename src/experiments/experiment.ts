// Headless Simulation Engine for Scientific Experiments & Benchmarking

import { LIFNetwork, NeuronIndex } from '../sim/lif';
import { AgentPool, AgentSlot, SENSOR_CHANNELS } from '../sim/agent';
import { PRNG } from '../sim/worker';
import type { ExperimentConfig, ExperimentResult } from './config';

export class ExperimentEngine {
  static run(config: ExperimentConfig): ExperimentResult {
    const {
      seed,
      agentCount,
      durationSeconds,
      baselineMode,
      enableObstacles,
      worldW = 900,
      worldH = 600,
      scentSources = [[worldW / 2, worldH / 2]],
      stdpEveryNTicks = 1,
    } = config;

    const prng = new PRNG(seed);
    const pool = new AgentPool(agentCount);

    const flatSources = new Float32Array(scentSources.length * 2);
    for (let i = 0; i < scentSources.length; i++) {
      flatSources[i * 2]     = scentSources[i][0];
      flatSources[i * 2 + 1] = scentSources[i][1];
    }
    pool.odorField.setSourcesFromFlat(flatSources);

    // Obstacles layout if enabled
    const obstacleArr = enableObstacles
      ? new Float32Array([
          worldW * 0.35, worldH * 0.5, 30,
          worldW * 0.65, worldH * 0.5, 30,
        ])
      : new Float32Array([0, 0, 0]);
    const numObs = (obstacleArr.length / 3) | 0;

    // SNN networks initialization
    const nets: LIFNetwork[] = [];
    if (baselineMode === 'SNN_NO_STDP' || baselineMode === 'SNN_WITH_STDP') {
      for (let a = 0; a < agentCount; a++) {
        const net = new LIFNetwork(32);
        net.initChemotaxisWiring();
        net.randomizeWeights(prng);
        net.initChemotaxisWiring();
        nets.push(net);
      }
    }

    // Spawn agents deterministically
    for (let a = 0; a < agentCount; a++) {
      pool.spawn(
        a,
        prng.next() * worldW,
        prng.next() * worldH,
        prng.next() * Math.PI * 2
      );
    }

    const totalTicks = Math.round(durationSeconds * 60);
    const dt = 1000 / 60; // 16.666667 ms fixed step
    const targetX = scentSources[0][0];
    const targetY = scentSources[0][1];

    // Track start positions for path efficiency metric
    const startX = new Float32Array(agentCount);
    const startY = new Float32Array(agentCount);
    for (let a = 0; a < agentCount; a++) {
      const b = a * AgentSlot._COUNT;
      startX[a] = pool.buf[b + AgentSlot.X];
      startY[a] = pool.buf[b + AgentSlot.Y];
    }
    const timeToTarget = new Float32Array(agentCount);
    let totalSpikes = 0;
    const startWallTime = performance.now();

    // ── Simulation Execution Loop ───────────────────────────────────────────
    for (let tick = 1; tick <= totalTicks; tick++) {
      const doSTDP = baselineMode === 'SNN_WITH_STDP' && (tick % stdpEveryNTicks === 0);

      for (let a = 0; a < agentCount; a++) {
        const b = a * AgentSlot._COUNT;
        const ax = pool.buf[b + AgentSlot.X];
        const ay = pool.buf[b + AgentSlot.Y];

        // Target distance check
        const dx = ax - targetX;
        const dy = ay - targetY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 30.0 && timeToTarget[a] === 0.0) {
          timeToTarget[a] = tick * (dt * 0.001);
          pool.targetAcquired[a] = 1;
        }

        // Sensing
        pool.readOlfactorySensors(a, flatSources, scentSources.length);
        pool.checkCollision(a, obstacleArr, numObs);

        const sb = a * SENSOR_CHANNELS;

        // ── Controller Logic by Baseline Mode ───────────────────────────────
        if (baselineMode === 'BASELINE_RANDOM') {
          // Brownian random walk
          const motorL = (prng.next() * 2.0 - 1.0);
          const motorR = (prng.next() * 2.0 - 1.0);
          pool.applyMotor(a, motorL, motorR);
        } else if (baselineMode === 'BASELINE_BRAITENBERG') {
          // Direct crossed tropotaxis (Left antenna -> Right motor, Right antenna -> Left motor)
          const sensL = pool.sensorOut[sb + 0]; // left antenna band 0
          const sensR = pool.sensorOut[sb + 4]; // right antenna band 0
          const colF  = pool.sensorOut[sb + 8]; // front obstacle
          const colL  = pool.sensorOut[sb + 9]; // left obstacle
          const colR  = pool.sensorOut[sb + 10]; // right obstacle

          let motorL = sensR * 1.5 + 0.2;
          let motorR = sensL * 1.5 + 0.2;

          // Obstacle avoidance reflex
          if (colF > 0.5) { motorL = -0.5; motorR = 0.8; }
          else if (colL > 0.5) { motorL = 0.8; motorR = -0.3; }
          else if (colR > 0.5) { motorL = -0.3; motorR = 0.8; }

          pool.applyMotor(a, Math.max(-1.0, Math.min(1.0, motorL)), Math.max(-1.0, Math.min(1.0, motorR)));
        } else {
          // SNN (SNN_NO_STDP or SNN_WITH_STDP)
          const net = nets[a];
          // Inject olfactory
          for (let s = 0; s < 8; s++) {
            const sig = pool.sensorOut[sb + s];
            if (sig > 0.01) net.inject(s, sig * 2.0);
          }
          // Inject collision
          for (let s = 8; s < 11; s++) {
            const sig = pool.sensorOut[sb + s];
            if (sig > 0.5) net.inject(s, 3.0);
          }

          net.tick(dt);
          if (doSTDP) net.applySTDP();

          for (let i = 0; i < 32; i++) {
            if (net.spikes[i]) totalSpikes++;
          }

          const spikeL = net.spikes[NeuronIndex.MOTOR_L];
          const spikeR = net.spikes[NeuronIndex.MOTOR_R];
          pool.applyMotor(a, spikeL ? 1.0 : -0.1, spikeR ? 1.0 : -0.1);
        }

        pool.tick(a, dt, worldW, worldH);
      }
    }

    const elapsedWallTime = performance.now() - startWallTime;

    // ── Metric Computations ─────────────────────────────────────────────────
    let acquiredCount = 0;
    let sumTimeToTarget = 0;
    let sumPathLength = 0;
    let totalCollisions = 0;

    for (let a = 0; a < agentCount; a++) {
      if (pool.targetAcquired[a]) {
        acquiredCount++;
        sumTimeToTarget += timeToTarget[a];
      }
      sumPathLength += pool.distanceTravelled[a];
      totalCollisions += pool.collisionCount[a];
    }

    const successRate = acquiredCount / agentCount;
    const meanTimeToSource = acquiredCount > 0 ? sumTimeToTarget / acquiredCount : 0.0;
    const meanPathLength = sumPathLength / agentCount;
    const N = NeuronIndex.TOTAL;
    const totalNeurons = agentCount * N;
    const meanSpikeRateHz = totalSpikes / (totalNeurons * durationSeconds);

    // Path efficiency: Euclidean start-to-target / path_length for each successful agent
    let sumEfficiency = 0;
    let efficiencyCount = 0;
    let sumFinalDist = 0;
    for (let a = 0; a < agentCount; a++) {
      const b = a * AgentSlot._COUNT;
      const ax = pool.buf[b + AgentSlot.X];
      const ay = pool.buf[b + AgentSlot.Y];
      // Final distance to target for all agents
      const fdx = ax - targetX;
      const fdy = ay - targetY;
      sumFinalDist += Math.sqrt(fdx * fdx + fdy * fdy);

      if (pool.targetAcquired[a] && pool.distanceTravelled[a] > 0) {
        const sdx = startX[a] - targetX;
        const sdy = startY[a] - targetY;
        const euclidean = Math.sqrt(sdx * sdx + sdy * sdy);
        sumEfficiency += euclidean / pool.distanceTravelled[a];
        efficiencyCount++;
      }
    }
    const pathEfficiency = efficiencyCount > 0 ? sumEfficiency / efficiencyCount : 0.0;
    const meanFinalDistanceToTarget = sumFinalDist / agentCount;

    let sumWeightChange = 0;
    let potentiated = 0;
    let depressed = 0;
    let plasticSynapses = 0;

    if (nets.length > 0) {
      for (let a = 0; a < agentCount; a++) {
        const net = nets[a];
        const len = net.weights.length;
        for (let i = 0; i < len; i++) {
          if (net.plasticityMask[i] === 1) {
            plasticSynapses++;
            const dw = net.weights[i] - net.initialWeights[i];
            sumWeightChange += dw;
            if (dw > 0.02) potentiated++;
            else if (dw < -0.02) depressed++;
          }
        }
      }
    }

    const meanWeightChange = plasticSynapses > 0 ? sumWeightChange / plasticSynapses : 0.0;

    return {
      config,
      totalTicks,
      simulationWallTimeMs: elapsedWallTime,
      ticksPerSecond: (totalTicks / (elapsedWallTime * 0.001)),
      successRate,
      meanTimeToSourceSeconds: meanTimeToSource,
      meanPathLength,
      pathEfficiency,
      totalCollisions,
      meanFinalDistanceToTarget,
      meanSpikeRateHz,
      meanWeightChange,
      potentiatedSynapses: potentiated,
      depressedSynapses: depressed,
      timestamp: new Date().toISOString(),
    };
  }
}
