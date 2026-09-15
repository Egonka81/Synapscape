// Unit Tests for Seed Reproducibility & Fixed-Timestep Invariance

import { ExperimentEngine } from '../experiments/experiment';
import type { ExperimentConfig } from '../experiments/config';

export function runDeterminismTests(): boolean {
  console.log('[TEST SUITE] Determinism & Reproducibility Tests:');
  let passed = true;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      passed = false;
    }
  }

  const baseConfig: ExperimentConfig = {
    seed: 42,
    agentCount: 20,
    durationSeconds: 5,
    baselineMode: 'SNN_WITH_STDP',
    enableObstacles: true,
  };

  // 1. Bitwise identical trajectories with same seed
  {
    const runA = ExperimentEngine.run({ ...baseConfig, seed: 42 });
    const runB = ExperimentEngine.run({ ...baseConfig, seed: 42 });

    assert(
      runA.meanPathLength === runB.meanPathLength,
      `Identical path length with seed=42 (${runA.meanPathLength} === ${runB.meanPathLength})`
    );
    assert(
      runA.meanWeightChange === runB.meanWeightChange,
      `Identical mean weight change with seed=42 (${runA.meanWeightChange} === ${runB.meanWeightChange})`
    );
    assert(
      runA.totalCollisions === runB.totalCollisions,
      `Identical collisions with seed=42 (${runA.totalCollisions} === ${runB.totalCollisions})`
    );
    assert(
      runA.successRate === runB.successRate,
      `Identical success rate with seed=42 (${runA.successRate} === ${runB.successRate})`
    );
  }

  // 2. Differing seeds produce distinct trajectories
  {
    const runA = ExperimentEngine.run({ ...baseConfig, seed: 42 });
    const runC = ExperimentEngine.run({ ...baseConfig, seed: 999 });

    assert(
      runA.meanPathLength !== runC.meanPathLength,
      `Different seeds yield diverging paths (seed 42: ${runA.meanPathLength.toFixed(2)} != seed 999: ${runC.meanPathLength.toFixed(2)})`
    );
    assert(
      runA.meanWeightChange !== runC.meanWeightChange,
      `Different seeds yield distinct synaptic adaptation (${runA.meanWeightChange.toFixed(5)} != ${runC.meanWeightChange.toFixed(5)})`
    );
  }

  // 3. Fixed timestep invariance
  {
    const run1 = ExperimentEngine.run({ ...baseConfig, seed: 1234, durationSeconds: 4 });
    const run2 = ExperimentEngine.run({ ...baseConfig, seed: 1234, durationSeconds: 4 });
    assert(
      run1.totalTicks === run2.totalTicks && run1.totalTicks === 240,
      `Fixed timestep preserves exact tick count (240 ticks for 4s)`
    );
  }

  return passed;
}
