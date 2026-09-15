// High-Performance Simulation Throughput Benchmark Suite
// Evaluates raw simulation performance across scaling agent populations

import { LIFNetwork, NeuronIndex } from '../sim/lif';
import { AgentPool, AgentSlot, SENSOR_CHANNELS } from '../sim/agent';
import { PRNG } from '../sim/worker';

export interface BenchmarkResult {
  agentCount: number;
  totalTicks: number;
  totalWallTimeMs: number;
  ticksPerSecond: number;
  avgTickDurationMs: number;
  synapticUpdatesPerSec: number;
  memoryEstimateMB: number;
}

export class SimulationBenchmark {
  static runBenchmark(agentCount: number, ticks = 600): BenchmarkResult {
    const prng = new PRNG(42);
    const pool = new AgentPool(agentCount);
    const nets: LIFNetwork[] = [];

    const scentSrc = new Float32Array([450, 300]);
    // Empty obstacle array: no obstacles in benchmark for clean throughput measurement
    const obstacleArr = new Float32Array(0);
    const numObs = 0;

    for (let a = 0; a < agentCount; a++) {
      const net = new LIFNetwork(32);
      net.initChemotaxisWiring();
      net.randomizeWeights(prng);
      net.initChemotaxisWiring();
      nets.push(net);
      pool.spawn(a, prng.next() * 900, prng.next() * 600, prng.next() * Math.PI * 2);
    }

    const dt = 1000 / 60;
    const startTime = performance.now();

    for (let t = 0; t < ticks; t++) {
      for (let a = 0; a < agentCount; a++) {
        const net = nets[a];
        pool.readOlfactorySensors(a, scentSrc, 1);
        pool.checkCollision(a, obstacleArr, numObs);

        const sb = a * SENSOR_CHANNELS;
        for (let s = 0; s < 8; s++) {
          const sig = pool.sensorOut[sb + s];
          if (sig > 0.01) net.inject(s, sig * 2.0);
        }

        net.tick(dt);
        net.applySTDP();

        const spikeL = net.spikes[NeuronIndex.MOTOR_L];
        const spikeR = net.spikes[NeuronIndex.MOTOR_R];
        pool.applyMotor(a, spikeL ? 1.0 : -0.1, spikeR ? 1.0 : -0.1);
        pool.tick(a, dt, 900, 600);
      }
    }

    const totalWallTimeMs = performance.now() - startTime;
    const ticksPerSecond = (ticks / (totalWallTimeMs * 0.001));
    const avgTickDurationMs = totalWallTimeMs / ticks;
    // 32 * 32 = 1024 synapses per agent
    const synapticUpdatesPerSec = agentCount * 1024 * ticksPerSecond;
    const memoryEstimateMB = (agentCount * (AgentSlot._COUNT * 4 + SENSOR_CHANNELS * 4 + LIFNetwork.bufferSize(32))) / (1024 * 1024);

    return {
      agentCount,
      totalTicks: ticks,
      totalWallTimeMs,
      ticksPerSecond,
      avgTickDurationMs,
      synapticUpdatesPerSec,
      memoryEstimateMB,
    };
  }

  static runSuite(): BenchmarkResult[] {
    const scales = [1, 10, 100, 1000, 5000];
    const results: BenchmarkResult[] = [];

    console.log('\n================================================================================================');
    console.log('                            SYNAPSCAPE PURE SIMULATION BENCHMARK                                ');
    console.log('================================================================================================');

    const header = [
      'Agents'.padEnd(10),
      'Ticks/sec'.padEnd(14),
      'Avg Tick (ms)'.padEnd(16),
      'Synapse Ops/s'.padEnd(18),
      'Est Memory (MB)'.padEnd(16),
      'Realtime Ratio'.padEnd(16),
    ].join(' | ');

    console.log(header);
    console.log('-'.repeat(header.length));

    for (const count of scales) {
      // Warmup
      this.runBenchmark(Math.min(count, 50), 30);
      const testTicks = count >= 5000 ? 120 : (count >= 1000 ? 300 : 600);
      const res = this.runBenchmark(count, testTicks);
      results.push(res);

      const ratio = (res.ticksPerSecond / 60.0).toFixed(1) + 'x';
      const row = [
        count.toString().padEnd(10),
        res.ticksPerSecond.toFixed(1).padEnd(14),
        res.avgTickDurationMs.toFixed(3).padEnd(16),
        (res.synapticUpdatesPerSec / 1e6).toFixed(2) + ' M ops/s'.padEnd(10),
        res.memoryEstimateMB.toFixed(2).padEnd(16),
        ratio.padEnd(16),
      ].join(' | ');
      console.log(row);
    }

    console.log('================================================================================================\n');
    return results;
  }
}

if (process.argv[1] && process.argv[1].includes('benchmark')) {
  SimulationBenchmark.runSuite();
}
