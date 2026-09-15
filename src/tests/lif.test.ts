// Unit Tests for Leaky Integrate-and-Fire (LIF) Dynamics

import { LIFNetwork } from '../sim/lif';

export function runLIFTests(): boolean {
  console.log('[TEST SUITE] LIF Dynamics Tests:');
  let passed = true;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      passed = false;
    }
  }

  // 1. Sub-threshold decay toward resting potential (-65 mV)
  {
    const net = new LIFNetwork(4);
    net.state[0] = -55.0; // Depolarized subthreshold
    const dt = 16.666667;
    net.tick(dt);
    const v1 = net.state[0];
    assert(v1 < -55.0 && v1 >= -65.0, `Membrane decays toward V_rest after 1 tick (-55mV -> ${v1.toFixed(2)}mV)`);

    // Step forward 10 ticks to reach asymptotic equilibrium
    for (let t = 0; t < 9; t++) {
      net.tick(dt);
    }
    const finalV = net.state[0];
    assert(Math.abs(finalV - -65.0) < 0.05, `Membrane reaches V_rest equilibrium (-65.0mV): got ${finalV.toFixed(2)}mV`);
  }

  // 2. Action potential generation when reaching V_thresh (-50 mV)
  {
    const net = new LIFNetwork(4);
    // Inject strong current to trigger spike
    net.inject(0, 3.0); // 3 nA * 10 MΩ = 30 mV -> -65 + 30 = -35 mV > -50 mV
    net.tick(16.666667);
    assert(net.spikes[0] === 1, 'Action potential (spike === 1) triggered on suprathreshold input');
  }

  // 3. Voltage reset to V_reset (-70 mV) post-spike
  {
    const net = new LIFNetwork(4);
    net.inject(0, 3.0);
    net.tick(16.666667);
    assert(net.state[0] === -70.0, `Voltage resets to V_reset (-70mV), got ${net.state[0]}mV`);
  }

  // 4. Absolute refractory period clamp (tRefrac = 2.0 ms)
  {
    const net = new LIFNetwork(4);
    net.inject(0, 3.0);
    net.tick(16.666667); // spikes, enters refractory period
    // Immediately attempt another injection during remaining refractory clamp
    net.inject(0, 5.0);
    net.tick(1.0); // 1.0 ms elapsed, still within refractory period
    assert(net.spikes[0] === 0, 'Spike inhibited during absolute refractory period');
  }

  return passed;
}
