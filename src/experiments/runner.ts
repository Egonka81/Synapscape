// Experiment Batch Runner & Report Generator

import { ExperimentEngine } from './experiment';
import { MetricsAnalyzer } from './metrics';
import type { BaselineMode, ExperimentConfig, ExperimentResult } from './config';
import * as fs from 'fs';
import * as path from 'path';

export function runComparisonSuite(seeds = [42, 101, 2024], durationSeconds = 30): ExperimentResult[] {
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

      process.stdout.write(` Running ${mode.padEnd(20)} [Seed: ${seed}]... `);
      const res = ExperimentEngine.run(config);
      results.push(res);
      console.log(`DONE (${res.ticksPerSecond.toFixed(0)} ticks/s, Success: ${(res.successRate * 100).toFixed(0)}%)`);
    }
  }

  return results;
}

export function main() {
  const results = runComparisonSuite([42, 101, 777], 20);

  console.log('\n=============================================================================================================');
  console.log('                                  SYNAPSCAPE BENCHMARK & EXPERIMENT RESULTS                                  ');
  console.log('=============================================================================================================\n');
  console.log(MetricsAnalyzer.formatSummaryTable(results));
  console.log('\n=============================================================================================================\n');

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
