// Experiment Batch Runner & Report Generator

import { ExperimentEngine } from './experiment';
import { MetricsAnalyzer } from './metrics';
import type { BaselineMode, ExperimentConfig, ExperimentResult } from './config';
import * as fs from 'fs';
import * as path from 'path';

// 10 seeds for credible within-condition variance estimates
const DEFAULT_SEEDS = [42, 101, 201, 303, 404, 505, 606, 707, 808, 999];

export function runComparisonSuite(
  seeds = DEFAULT_SEEDS,
  durationSeconds = 30
): ExperimentResult[] {
  const modes: BaselineMode[] = [
    'BASELINE_RANDOM',
    'BASELINE_BRAITENBERG',
    'SNN_NO_STDP',
    'SNN_WITH_STDP',
  ];

  const results: ExperimentResult[] = [];

  console.log(`\nStarting Synapscape Experiment Suite (${modes.length} modes × ${seeds.length} seeds)...`);

  for (const mode of modes) {
    for (const seed of seeds) {
      const config: ExperimentConfig = {
        seed,
        agentCount: 40,
        durationSeconds,
        baselineMode: mode,
        enableObstacles: false,
      };

      process.stdout.write(` Running ${mode.padEnd(22)} [Seed: ${String(seed).padEnd(4)}]... `);
      const res = ExperimentEngine.run(config);
      results.push(res);
      console.log(
        `DONE (${res.ticksPerSecond.toFixed(0)} ticks/s, ` +
        `Success: ${(res.successRate * 100).toFixed(0)}%, ` +
        `PathEff: ${res.pathEfficiency > 0 ? res.pathEfficiency.toFixed(3) : 'N/A'})`
      );
    }
  }

  return results;
}

export function main() {
  const results = runComparisonSuite(DEFAULT_SEEDS, 20);

  const sep = '='.repeat(140);
  console.log(`\n${sep}`);
  console.log('                                  SYNAPSCAPE EXPERIMENT RESULTS — PER-RUN TABLE');
  console.log(`${sep}\n`);
  console.log(MetricsAnalyzer.formatSummaryTable(results));
  console.log(`\n${sep}\n`);

  console.log('                              SYNAPSCAPE AGGREGATE STATISTICS (mean ± SE, N = 10 seeds per condition)');
  console.log(MetricsAnalyzer.formatAggregateTable(results));
  console.log(`\n${sep}\n`);

  const outDir = path.join(process.cwd(), 'experiments_output');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const jsonPath = path.join(outDir, 'results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Saved JSON experiment metrics to: ${jsonPath}`);

  const csvPath = path.join(outDir, 'results.csv');
  fs.writeFileSync(csvPath, MetricsAnalyzer.toCSV(results), 'utf-8');
  console.log(`Saved CSV experiment metrics to: ${csvPath}\n`);
}

// Check if run directly
if (process.argv[1] && process.argv[1].includes('runner')) {
  main();
}

