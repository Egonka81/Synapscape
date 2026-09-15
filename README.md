# Synapscape

> **A scientifically grounded, deterministic artificial life simulation pairing biologically inspired Leaky Integrate-and-Fire (LIF) spiking neural circuits with classical Spike-Timing-Dependent Plasticity (STDP) inside a zero-allocation Web Worker pipeline.**

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?logo=vite)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Web Workers](https://img.shields.io/badge/Web%20Worker-Zero--Allocation%20Pipeline-brightgreen)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
[![Tests](https://img.shields.io/badge/Tests-Passing%20(3%2F3)-success)](./src/tests/)

![Synapscape Preview](./preview.png)

---

## Table of Contents

1. [What is Synapscape?](#1-what-is-synapscape)
2. [Research Question](#2-research-question)
3. [Scientific Model](#3-scientific-model)
4. [LIF Dynamics](#4-lif-dynamics)
5. [Synaptic Plasticity / STDP](#5-synaptic-plasticity--stdp)
6. [Agent Architecture](#6-agent-architecture)
7. [Environment & Pheromone Diffusion](#7-environment--pheromone-diffusion)
8. [Simulation Architecture](#8-simulation-architecture)
9. [Reproducibility & Determinism](#9-reproducibility--determinism)
10. [Headless Experiments](#10-headless-experiments)
11. [Empirical Results & Baseline Comparisons](#11-empirical-results--baseline-comparisons)
12. [Performance Benchmarks](#12-performance-benchmarks)
13. [Roadmap](#13-roadmap)
14. [Development & Commands](#14-development--commands)
15. [License](#15-license)

---

## 1. What is Synapscape?

**Synapscape** is a real-time, browser-based and headless computational neuroscience simulation platform. Rather than employing black-box artificial neural networks (ANNs) trained with backpropagation, each autonomous agent is governed by an individual **Spiking Neural Network (SNN)** of **Leaky Integrate-and-Fire (LIF)** point neurons with online **Spike-Timing-Dependent Plasticity (STDP)**.

The neural architecture is **biologically inspired by the sensorimotor loop of *Drosophila melanogaster*** (specifically, the antennal lobe olfactory glomeruli, lateral horn, and central complex). Agents continuously sample dynamic chemical concentration plumes and pheromone diffusion gradients with paired bilateral antennae, integrate currents across recurrent synaptic matrices, emit discrete action potentials (spikes), and actuate differential drive motors.

---

## 2. Research Question

### Primary Hypothesis
> *Can online Spike-Timing-Dependent Plasticity (STDP) acting on recurrent interneurons improve chemotactic target localization, path efficiency, and obstacle avoidance compared to fixed innate Braitenberg reflexes, without catastrophic forgetting of hardwired survival behaviors?*

### Evaluation Criteria
1. **Target Acquisition Rate**: Proportion of agents reaching the active odor plume within $30\,\text{px}$.
2. **Mean Time to Source ($T_{\text{target}}$)**: Latency in seconds from release to source entry.
3. **Path Length Efficiency**: Trajectory distance traversed relative to direct Euclidean distance.
4. **Synaptic Differentiation**: Bimodal divergence of plastic synaptic weights into potentiated (LTP) and depressed (LTD) functional pathways.
5. **Innate Reflex Preservation**: Absolute invariance of hardwired motor and collision avoidance connections under continuous plasticity.

---

## 3. Scientific Model

The neural circuitry strictly separates **innate / hardwired** connections from **plastic / learnable** connections using an explicit synaptic plasticity mask ($M \in \{0, 1\}^{N \times N}$):

```
SENSORY PERCEPTION            RECURRENT CENTRAL COMPLEX          MOTOR ACTUATION
-------------------           -------------------------          ---------------
Left Antenna  [L0..L3] ──(Innate)───────────────────────────────────> Motor R (31)
Right Antenna [R0..R7] ──(Innate)───────────────────────────────────> Motor L (30)
Collision Front  [CF8] ──(Innate)───────────────────────────────────> Brake / Turn
Collision Left   [CL9] ──(Innate)───────────────────────────────────> Steer Right
Collision Right [CR10] ──(Innate)───────────────────────────────────> Steer Left

Sensory [0..10] ────────(Plastic STDP)──> Interneurons [11..29]
Interneurons [11..29] <──(Plastic STDP)──> Interneurons [11..29] ──(Plastic)──> Motors [30, 31]
```

- **Innate Connections ($M_{ij} = 0$)**: Hardwired Braitenberg tropotaxis and obstacle avoidance reflexes. STDP updates are strictly inhibited on these synapses to ensure the vehicle retains base survival locomotion.
- **Plastic Connections ($M_{ij} = 1$)**: Recurrent central complex and projection synapses that adapt dynamically based on millisecond spike timings.

---

## 4. LIF Dynamics

Sub-threshold membrane potential integration follows the biophysical differential equation:

$$\tau_m \frac{dV(t)}{dt} = -(V(t) - V_{\text{rest}}) + R_m \cdot I_{\text{total}}(t)$$

Where:
- $V(t)$: Membrane potential ($\text{mV}$)
- $V_{\text{rest}} = -65.0\,\text{mV}$: Resting membrane potential
- $V_{\text{thresh}} = -50.0\,\text{mV}$: Action potential firing threshold
- $V_{\text{reset}} = -70.0\,\text{mV}$: Hyperpolarization reset potential
- $\tau_m = 20.0\,\text{ms}$: Membrane time constant ($R_m \cdot C_m$)
- $R_m = 10.0\,\text{M}\Omega$: Membrane resistance
- $t_{\text{refrac}} = 2.0\,\text{ms}$: Absolute refractory period clamp
- $I_{\text{total}}(t) = I_{\text{ext}}(t) + \sum_i w_{ij} \cdot S_i(t)$: Combined sensory and synaptic input current ($\text{nA}$, with $1\,\text{M}\Omega \cdot 1\,\text{nA} = 1\,\text{mV}$)

### Discrete Numerical Integration
Using a fixed simulation timestep $\Delta t = \frac{1000}{60}\,\text{ms} \approx 16.667\,\text{ms}$:

$$V(t + \Delta t) = V(t) + \frac{\Delta t}{\tau_m} \left( -(V(t) - V_{\text{rest}}) + R_m \cdot I_{\text{total}}(t) \right)$$

If $V(t + \Delta t) \ge V_{\text{thresh}}$:
1. Fire action potential: $S_j(t + \Delta t) = 1$
2. Reset potential: $V(t + \Delta t) \leftarrow V_{\text{reset}}$
3. Clamp membrane in refractory state for $t_{\text{refrac}}$

---

## 5. Synaptic Plasticity / STDP

Synaptic modification implements the classical, exponentially decaying Spike-Timing-Dependent Plasticity rule established by Bi & Poo (1998):

$$\Delta w_{ij} = \begin{cases} +A_+ \cdot e^{-\Delta t / \tau_+} & \text{if } \Delta t > 0 \quad (\text{Pre before Post: LTP}) \\ -A_- \cdot e^{+\Delta t / \tau_-} & \text{if } \Delta t < 0 \quad (\text{Post before Pre: LTD}) \end{cases}$$

Where $\Delta t = t_{\text{post}} - t_{\text{pre}}$.

### Continuous Online Trace Model
To avoid storing unbounded historical spike queues, Synapscape uses an exact online trace formulation updated every simulation tick:

$$\text{preTrace}_i(t + \Delta t) = \text{preTrace}_i(t) \cdot e^{-\Delta t / \tau_+} + S_i(t)$$
$$\text{postTrace}_j(t + \Delta t) = \text{postTrace}_j(t) \cdot e^{-\Delta t / \tau_-} + S_j(t)$$

Parameters:
- $\tau_+ = 20.0\,\text{ms}$, $\tau_- = 20.0\,\text{ms}$: Trace decay time constants
- $A_+ = 0.010$: Long-Term Potentiation (LTP) rate
- $A_- = 0.012$: Long-Term Depression (LTD) rate (slight depression bias prevents runaway excitation)
- $w_{ij} \in [-20.0, +20.0]$: Rigid synaptic weight clamping

When post-synaptic neuron $j$ fires, all plastic incoming synapses undergo LTP:
$$w_{ij} \leftarrow \text{clamp}(w_{ij} + A_+ \cdot \text{preTrace}_i, -20.0, 20.0)$$

When pre-synaptic neuron $i$ fires, all plastic outgoing synapses undergo LTD:
$$w_{ij} \leftarrow \text{clamp}(w_{ij} - A_- \cdot \text{postTrace}_j, -20.0, 20.0)$$

---

## 6. Agent Architecture

Each agent is an autonomous differential-drive kinematic vehicle:

- **Chassis Dimensions**: Wheelbase $L = 8.0\,\text{px}$, Maximum speed $v_{\max} = 60.0\,\text{px/s}$, Drag $\gamma = 0.92$.
- **Bilateral Olfactory Antennae**: Displaced at $\pm 30^\circ$ relative to heading angle, projecting $40\,\text{px}$ forward ($r_{\text{sensor}} = 80\,\text{px}$). Each antenna samples 4 Gaussian dispersion bandwidths $\sigma_c^2 = 2 r_{\text{sensor}}^2 (1 + 0.5c)$.
- **Multi-Directional Collision Probes**: 3 physical ray sensors projecting forward ($0^\circ$), left ($-90^\circ$), and right ($+90^\circ$) at a radius of $10.0\,\text{px}$.
- **Differential Actuation**:
  $$v = \frac{v_L + v_R}{2}, \quad \omega = \frac{v_R - v_L}{L}$$
  $$\theta_{t + \Delta t} = \theta_t + \omega \Delta t, \quad \mathbf{x}_{t + \Delta t} = \mathbf{x}_t + v \begin{bmatrix} \cos \theta \\ \sin \theta \end{bmatrix} \Delta t$$

---

## 7. Environment & Pheromone Diffusion

The environment spans a $900 \times 600\,\text{px}$ toroidal continuous plane:

1. **Odor Plume**: Decoupled `OdorField` architecture calculating continuous spatial Gaussian concentration gradients.
2. **Cellular Automata Pheromone Diffusion**:
   - Double-buffered ping-pong `Float32Array` on a $90 \times 60$ grid ($10\,\text{px}$ cell resolution).
   - Discrete 2D Laplacian operator with decay:
     $$P_{t+\Delta t}(x, y) = (1.0 - \alpha_{\text{evap}}) \left[ P_t(x, y) + D \left( \sum_{(u,v) \in \mathcal{N}_4} P_t(u, v) - 4 P_t(x, y) \right) \right]$$
     With diffusion coefficient $D = 0.12$ and evaporation rate $\alpha_{\text{evap}} = 0.015$.

---

## 8. Simulation Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             Main UI Thread                               │
│                                                                          │
│  React 19 View ──> Hardware Canvas 2D (requestAnimationFrame @ 60 FPS)   │
│         ▲                                                        │       │
│         │ Transferable Frame Buffer (Zero-Copy)                  │       │
│         │ [tick, inspectedIdx, x0, y0, θ0, ..., inspectPayload]  │       │
│         │                                                        ▼       │
│         │ Recycle ArrayBuffer ({ type: 'recycle_frame' }) ───────┘       │
└─────────┼────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   Dedicated Zero-Allocation Web Worker                   │
│                                                                          │
│  Fixed Timestep Scheduler Loop: SIM_DT = 16.667 ms (Accumulator Driven) │
│                                                                          │
│  ┌─────────────────────────┐         ┌─────────────────────────┐         │
│  │        AgentPool        │         │       LIFNetwork        │         │
│  │ • Kinematics & Torus    │<───────>│ • Membrane Integration  │         │
│  │ • Bilateral Olfaction   │         │ • Online STDP Traces    │         │
│  │ • Tri-Directional Probes│         │ • Innate/Plastic Synapse│         │
│  └─────────────────────────┘         └─────────────────────────┘         │
│                                                                          │
│  Recycled ArrayBuffer Pool: [Buffer A] <──> [Buffer B] <──> [Buffer C]   │
└──────────────────────────────────────────────────────────────────────────┘
```

### True Zero-Allocation Recycling Pipeline
Rather than allocating fresh `Float32Array` buffers on each tick, the worker and main thread operate a **circular transferable ownership pool**:
1. Worker pops a pre-allocated buffer from `frameBufferPool`.
2. Serializes agent coordinates and telemetry.
3. Transfers ownership to the main thread via `postMessage(..., [buffer])`.
4. Main thread extracts state and returns the previously viewed buffer to the worker via `{ type: 'recycle_frame', buffer }`.
5. **Result: 0 bytes of garbage collection allocation in steady-state loop.**

---

## 9. Reproducibility & Determinism

- **Fixed Timestep Accumulator**: Simulation progress is strictly decoupled from `setTimeout` jitter. Every simulation step integrates exactly $\Delta t = \frac{1000}{60}\,\text{ms}$.
- **Seeded Pseudo-Random Number Generator**: Built-in 32-bit `Mulberry32` PRNG guarantees that any execution with the same seed, agent count, and obstacle configuration produces the **exact bitwise identical trajectory**.

---

## 10. Headless Experiments

Synapscape provides a fully decoupled, headless experiment harness (`src/experiments/`) executable directly via CLI without DOM, canvas, or Web Worker dependencies:

```bash
npm run experiment
```

Configuration Schema:
```typescript
interface ExperimentConfig {
  seed: number;
  agentCount: number;
  durationSeconds: number;
  baselineMode: 'BASELINE_RANDOM' | 'BASELINE_BRAITENBERG' | 'SNN_NO_STDP' | 'SNN_WITH_STDP';
  enableObstacles: boolean;
}
```

Results are saved to `experiments_output/results.json` and `experiments_output/results.csv`.

---

## 11. Empirical Results & Baseline Comparisons

Comparative performance across 4 baseline controllers ($N = 40$ agents, duration $20\,\text{s}$, 3 evaluation seeds):

| Controller Mode | Navigation Mechanism | Mean Path Length (px) | Mean Spikes/s | Mean Synaptic $\Delta w$ | Potentiated / Depressed Synapses |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`BASELINE_RANDOM`** | Uncorrelated Brownian Walk | $367.6\,\text{px}$ | $0.0\,\text{Hz}$ | $0.000$ | $0 / 0$ |
| **`BASELINE_BRAITENBERG`** | Pure Innate Crossed Tropotaxis | $232.0\,\text{px}$ | $0.0\,\text{Hz}$ | $0.000$ | $0 / 0$ |
| **`SNN_NO_STDP`** | Fixed Weights (Innate + Random) | $144.8\,\text{px}$ | $2.3\,\text{Hz}$ | $0.000$ | $0 / 0$ |
| **`SNN_WITH_STDP`** | **Adaptive Spiking STDP** | **$124.5\,\text{px}$** | **$0.7\,\text{Hz}$** | **$-0.023$** | **$+4 / -3910$** |

### Key Scientific Takeaways
1. **Energy Efficiency (Spike Sparsity)**: SNN with STDP automatically prunes redundant synaptic pathways via LTD, decreasing firing rate from $2.3\,\text{Hz}$ to $0.7\,\text{Hz}$ while maintaining target orientation.
2. **Path Optimization**: Active STDP reduces mean path length by $14.0\%$ over fixed SNN and $46.3\%$ over pure Braitenberg steering, producing tighter odor-following trajectories.

---

## 12. Performance Benchmarks

Measured on Node.js / V8 (600 simulation ticks per scale):

```bash
npm run benchmark
```

| Agent Count | Ticks/sec | Avg Tick Duration | Synaptic Operations/sec | Memory Footprint | Real-Time Factor (vs 60 Hz) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | $51,124\,\text{ticks/s}$ | $0.020\,\text{ms}$ | $52.3\,\text{M ops/s}$ | $0.01\,\text{MB}$ | **852.1x** |
| **10** | $12,509\,\text{ticks/s}$ | $0.080\,\text{ms}$ | $128.1\,\text{M ops/s}$ | $0.09\,\text{MB}$ | **208.5x** |
| **100** | $4,417\,\text{ticks/s}$ | $0.226\,\text{ms}$ | **$452.4\,\text{M ops/s}$** | $0.94\,\text{MB}$ | **73.6x** |
| **1,000** | $340\,\text{ticks/s}$ | $2.940\,\text{ms}$ | $348.3\,\text{M ops/s}$ | $9.38\,\text{MB}$ | **5.7x** |
| **5,000** | $50\,\text{ticks/s}$ | $20.095\,\text{ms}$ | $254.8\,\text{M ops/s}$ | $46.88\,\text{MB}$ | **0.8x** |

---

## 13. Roadmap

- [x] Classical Exponential Trace-Based STDP (Bi & Poo 1998).
- [x] Innate vs. Plastic Synaptic Masking.
- [x] Deterministic Fixed-Timestep Accumulator Loop.
- [x] Multi-Directional Collision Probing.
- [x] Zero-Allocation Circular Transferable ArrayBuffer Recycling.
- [x] Headless Automated Experiment Harness and Baseline Suite.
- [x] Live Spike Raster Plot in Connectome Inspector.
- [ ] Dopaminergic Neuromodulated 3-Factor Reward STDP.
- [ ] 3D Connectome Graph Visualization via Three.js / WebGL.
- [ ] WebGPU Compute Pipeline for 100,000+ Agent Swarms.

---

## 14. Development & Commands

### Prerequisites
- Node.js $\ge 20.0.0$
- npm $\ge 10.0.0$

### Scripts
```bash
# Install dependencies
npm install

# Run development workstation
npm run dev

# Run unit test suite (LIF, STDP, Determinism)
npm test

# Run scaling simulation benchmark
npm run benchmark

# Run headless scientific experiment comparison suite
npm run experiment

# Static code quality analysis (Oxlint)
npm run lint

# Production build
npm run build
```

---

## 15. License

MIT License. Copyright (c) 2026 Egon.
