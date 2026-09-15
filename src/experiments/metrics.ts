// Experiment Metrics Analysis & Data Serialization

import type { BaselineMode, ExperimentResult } from './config';

export interface AggregateStats {
  mode: BaselineMode;
  n: number;
  successRate:   { mean: number; sd: number; se: number };
  meanTimeToSourceSeconds: { mean: number; sd: number; se: number };
  meanPathLength: { mean: number; sd: number; se: number };
  pathEfficiency: { mean: number; sd: number; se: number };
  totalCollisions: { mean: number; sd: number; se: number };
  meanFinalDistanceToTarget: { mean: number; sd: number; se: number };
  meanSpikeRateHz: { mean: number; sd: number; se: number };
  meanWeightChange: { mean: number; sd: number; se: number };
}

function stats(values: number[]): { mean: number; sd: number; se: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, sd: 0, se: 0 };
  const mean = values.reduce((a, v) => a + v, 0) / n;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n > 1 ? n - 1 : 1);
  const sd = Math.sqrt(variance);
  return { mean, sd, se: sd / Math.sqrt(n) };
}

export class MetricsAnalyzer {
  static computeAggregateStats(results: ExperimentResult[]): AggregateStats[] {
    const modes = [...new Set(results.map((r) => r.config.baselineMode))] as BaselineMode[];
    return modes.map((mode) => {
      const group = results.filter((r) => r.config.baselineMode === mode);
      const n = group.length;
      return {
        mode,
        n,
        successRate:   stats(group.map((r) => r.successRate)),
        meanTimeToSourceSeconds: stats(group.map((r) => r.meanTimeToSourceSeconds)),
        meanPathLength: stats(group.map((r) => r.meanPathLength)),
        pathEfficiency: stats(group.map((r) => r.pathEfficiency)),
        totalCollisions: stats(group.map((r) => r.totalCollisions)),
        meanFinalDistanceToTarget: stats(group.map((r) => r.meanFinalDistanceToTarget)),
        meanSpikeRateHz: stats(group.map((r) => r.meanSpikeRateHz)),
        meanWeightChange: stats(group.map((r) => r.meanWeightChange)),
      };
    });
  }

  static formatSummaryTable(results: ExperimentResult[]): string {
    const header = [
      'Mode'.padEnd(22),
      'Seed'.padEnd(6),
      'Success'.padEnd(10),
      'Time (s)'.padEnd(10),
      'Path (px)'.padEnd(11),
      'Eff.'.padEnd(7),
      'FinalDist'.padEnd(11),
      'Collisions'.padEnd(12),
      'Spikes/s'.padEnd(10),
      'Mean Δw'.padEnd(10),
      '+ / -'.padEnd(12),
    ].join(' | ');

    const divider = '-'.repeat(header.length);
    const rows = results.map((r) => {
      const mode = r.config.baselineMode.padEnd(22);
      const seed = r.config.seed.toString().padEnd(6);
      const succ = `${(r.successRate * 100).toFixed(1)}%`.padEnd(10);
      const time = r.meanTimeToSourceSeconds > 0 ? r.meanTimeToSourceSeconds.toFixed(2).padEnd(10) : 'N/A'.padEnd(10);
      const path = r.meanPathLength.toFixed(1).padEnd(11);
      const eff  = r.pathEfficiency > 0 ? r.pathEfficiency.toFixed(3).padEnd(7) : 'N/A'.padEnd(7);
      const fdist = r.meanFinalDistanceToTarget.toFixed(1).padEnd(11);
      const cols = r.totalCollisions.toString().padEnd(12);
      const spk  = r.meanSpikeRateHz.toFixed(1).padEnd(10);
      const dw   = r.meanWeightChange.toFixed(3).padEnd(10);
      const ltp  = `+${r.potentiatedSynapses} / -${r.depressedSynapses}`.padEnd(12);
      return [mode, seed, succ, time, path, eff, fdist, cols, spk, dw, ltp].join(' | ');
    });

    return [header, divider, ...rows].join('\n');
  }

  static formatAggregateTable(results: ExperimentResult[]): string {
    const agg = MetricsAnalyzer.computeAggregateStats(results);

    const header = [
      'Mode'.padEnd(22),
      'N'.padEnd(4),
      'SuccRate (mean±SE)'.padEnd(22),
      'Path px (mean±SE)'.padEnd(22),
      'PathEff (mean±SE)'.padEnd(22),
      'FinalDist (mean±SE)'.padEnd(24),
      'Spikes/s (mean±SE)'.padEnd(22),
    ].join(' | ');

    const divider = '='.repeat(header.length);
    const rows = agg.map((a) => {
      const fmt = (s: { mean: number; sd: number; se: number }, digits = 3) =>
        `${s.mean.toFixed(digits)}±${s.se.toFixed(digits)}`;
      return [
        a.mode.padEnd(22),
        a.n.toString().padEnd(4),
        `${(a.successRate.mean * 100).toFixed(1)}%±${(a.successRate.se * 100).toFixed(1)}%`.padEnd(22),
        fmt(a.meanPathLength, 1).padEnd(22),
        fmt(a.pathEfficiency).padEnd(22),
        fmt(a.meanFinalDistanceToTarget, 1).padEnd(24),
        fmt(a.meanSpikeRateHz, 2).padEnd(22),
      ].join(' | ');
    });

    return [divider, header, divider, ...rows, divider].join('\n');
  }

  static toCSV(results: ExperimentResult[]): string {
    const headers = [
      'timestamp',
      'baselineMode',
      'seed',
      'agentCount',
      'durationSeconds',
      'successRate',
      'meanTimeToSourceSeconds',
      'meanPathLength',
      'pathEfficiency',
      'totalCollisions',
      'meanFinalDistanceToTarget',
      'meanSpikeRateHz',
      'meanWeightChange',
      'potentiatedSynapses',
      'depressedSynapses',
      'ticksPerSecond',
    ];

    const lines = results.map((r) => [
      r.timestamp,
      r.config.baselineMode,
      r.config.seed,
      r.config.agentCount,
      r.config.durationSeconds,
      r.successRate.toFixed(4),
      r.meanTimeToSourceSeconds.toFixed(3),
      r.meanPathLength.toFixed(2),
      r.pathEfficiency.toFixed(4),
      r.totalCollisions,
      r.meanFinalDistanceToTarget.toFixed(2),
      r.meanSpikeRateHz.toFixed(2),
      r.meanWeightChange.toFixed(4),
      r.potentiatedSynapses,
      r.depressedSynapses,
      r.ticksPerSecond.toFixed(1),
    ].join(','));

    return [headers.join(','), ...lines].join('\n');
  }
}
