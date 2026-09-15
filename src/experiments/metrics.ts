// Experiment Metrics Analysis & Data Serialization

import type { ExperimentResult } from './config';

export class MetricsAnalyzer {
  static formatSummaryTable(results: ExperimentResult[]): string {
    const header = [
      'Mode'.padEnd(22),
      'Seed'.padEnd(6),
      'Success'.padEnd(10),
      'Time (s)'.padEnd(10),
      'Path (px)'.padEnd(11),
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
      const cols = r.totalCollisions.toString().padEnd(12);
      const spk  = r.meanSpikeRateHz.toFixed(1).padEnd(10);
      const dw   = r.meanWeightChange.toFixed(3).padEnd(10);
      const ltp  = `+${r.potentiatedSynapses} / -${r.depressedSynapses}`.padEnd(12);
      return [mode, seed, succ, time, path, cols, spk, dw, ltp].join(' | ');
    });

    return [header, divider, ...rows].join('\n');
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
      'totalCollisions',
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
      r.totalCollisions,
      r.meanSpikeRateHz.toFixed(2),
      r.meanWeightChange.toFixed(4),
      r.potentiatedSynapses,
      r.depressedSynapses,
      r.ticksPerSecond.toFixed(1),
    ].join(','));

    return [headers.join(','), ...lines].join('\n');
  }
}
