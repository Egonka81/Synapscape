// Unit Tests for Classical Spike-Timing-Dependent Plasticity (STDP)

import { LIFNetwork } from '../sim/lif';

export function runSTDPTests(): boolean {
  console.log('[TEST SUITE] STDP Plasticity Tests:');
  let passed = true;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      passed = false;
    }
  }

  const dt = 16.666667;
  const syn01 = 1; // Synapse (pre=0 -> post=1) in 4-neuron network: 0 * 4 + 1 = 1

  // 1. Pre-before-post spike timing -> LTP (Weight Increase)
  {
    const net = new LIFNetwork(4);
    net.plasticityMask[syn01] = 1; // Synapse 0 -> 1 is plastic
    net.weights[syn01] = 5.0;

    // Tick 1: Pre-neuron (0) fires
    net.inject(0, 3.0);
    net.tick(dt);
    assert(net.spikes[0] === 1 && net.spikes[1] === 0, 'Tick 1: Pre-neuron fired');

    // Tick 2: Post-neuron (1) fires (pre fired before post!)
    net.inject(1, 3.0);
    net.tick(dt);
    net.applySTDP();

    const newW = net.weights[syn01];
    assert(newW > 5.0, `Pre-before-post produces LTP (weight increase from 5.0 to ${newW.toFixed(4)})`);
  }

  // 2. Post-before-pre spike timing -> LTD (Weight Decrease)
  {
    const net = new LIFNetwork(4);
    net.plasticityMask[syn01] = 1; // Synapse 0 -> 1 is plastic
    net.weights[syn01] = 5.0;

    // Tick 1: Post-neuron (1) fires
    net.inject(1, 3.0);
    net.tick(dt);
    assert(net.spikes[1] === 1 && net.spikes[0] === 0, 'Tick 1: Post-neuron fired');

    // Tick 2: Pre-neuron (0) fires (post fired before pre!)
    net.inject(0, 3.0);
    net.tick(dt);
    net.applySTDP();

    const newW = net.weights[syn01];
    assert(newW < 5.0, `Post-before-pre produces LTD (weight decrease from 5.0 to ${newW.toFixed(4)})`);
  }

  // 3. Temporal distance decay: larger Δt produces smaller weight delta
  {
    // Short Δt (1 tick delay)
    const netShort = new LIFNetwork(4);
    netShort.plasticityMask[syn01] = 1;
    netShort.weights[syn01] = 0.0;
    netShort.inject(0, 3.0);
    netShort.tick(dt);
    netShort.inject(1, 3.0);
    netShort.tick(dt);
    netShort.applySTDP();
    const deltaShort = netShort.weights[syn01];

    // Long Δt (3 ticks delay)
    const netLong = new LIFNetwork(4);
    netLong.plasticityMask[syn01] = 1;
    netLong.weights[syn01] = 0.0;
    netLong.inject(0, 3.0);
    netLong.tick(dt);
    netLong.tick(dt); // extra delay tick 1
    netLong.tick(dt); // extra delay tick 2
    netLong.inject(1, 3.0);
    netLong.tick(dt);
    netLong.applySTDP();
    const deltaLong = netLong.weights[syn01];

    assert(
      deltaShort > deltaLong && deltaLong > 0,
      `STDP exponential decay verified: Short Δt delta (${deltaShort.toFixed(5)}) > Long Δt delta (${deltaLong.toFixed(5)})`
    );
  }

  // 4. Strict weight bounding within [-20.0, +20.0]
  {
    const net = new LIFNetwork(4);
    net.plasticityMask[syn01] = 1;
    net.weights[syn01] = 19.995;

    // Trigger repeated LTP
    for (let i = 0; i < 20; i++) {
      net.inject(0, 3.0);
      net.tick(dt);
      net.inject(1, 3.0);
      net.tick(dt);
      net.applySTDP();
    }
    assert(net.weights[syn01] <= 20.0, `Weight upper bound respected (w <= 20.0): got ${net.weights[syn01]}`);

    // Trigger repeated LTD
    net.weights[syn01] = -19.995;
    for (let i = 0; i < 20; i++) {
      net.inject(1, 3.0);
      net.tick(dt);
      net.inject(0, 3.0);
      net.tick(dt);
      net.applySTDP();
    }
    assert(net.weights[syn01] >= -20.0, `Weight lower bound respected (w >= -20.0): got ${net.weights[syn01]}`);
  }

  // 5. Hardwired / innate synapses are never modified by STDP
  {
    const net = new LIFNetwork(32);
    net.initChemotaxisWiring();
    const synInnate = 31; // Left antenna 0 -> Right motor 31 (0 * 32 + 31 = 31)
    const innateWeight = net.weights[synInnate];
    assert(net.plasticityMask[synInnate] === 0, 'Innate synapse has plasticityMask === 0');

    // Repeated spikes on pre and post
    for (let i = 0; i < 10; i++) {
      net.inject(0, 3.0);
      net.tick(dt);
      net.inject(31, 3.0);
      net.tick(dt);
      net.applySTDP();
    }

    assert(
      net.weights[synInnate] === innateWeight,
      `Hardwired synapse remains exactly constant (${net.weights[synInnate]} === ${innateWeight})`
    );
  }

  return passed;
}
