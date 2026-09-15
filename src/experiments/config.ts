// Headless Experiment Configuration & Result Types

export type BaselineMode =
  | 'BASELINE_RANDOM'       // Uncorrelated random walk
  | 'BASELINE_BRAITENBERG'   // Pure Braitenberg tropotaxis (hardwired, no SNN)
  | 'SNN_NO_STDP'           // LIF Spiking network with fixed weights (no STDP)
  | 'SNN_WITH_STDP';        // Full LIF Spiking network with active online STDP plasticity

export interface ExperimentConfig {
  seed: number;
  agentCount: number;
  durationSeconds: number;
  baselineMode: BaselineMode;
  enableObstacles: boolean;
  worldW?: number;
  worldH?: number;
  scentSources?: [number, number][];
  stdpEveryNTicks?: number;
}

export interface ExperimentResult {
  config: ExperimentConfig;
  totalTicks: number;
  simulationWallTimeMs: number;
  ticksPerSecond: number;
  successRate: number;             // Fraction of agents acquiring target [0.0 .. 1.0]
  meanTimeToSourceSeconds: number; // Mean time to target for successful agents (0 if none reached)
  meanPathLength: number;          // Average distance travelled (px)
  pathEfficiency: number;          // Mean (Euclidean start-to-target / path_length) for successful agents; 0 if none
  totalCollisions: number;
  meanFinalDistanceToTarget: number; // Mean Euclidean distance to odor source at end of run (all agents)
  meanSpikeRateHz: number;
  meanWeightChange: number;        // Mean delta w over plastic synapses (current w - initial w)
  potentiatedSynapses: number;
  depressedSynapses: number;
  timestamp: string;
}
