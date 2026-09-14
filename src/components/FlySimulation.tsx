import { useEffect, useRef, useCallback, useState } from 'react';
import { SimClient } from '../sim/client';
import type { InspectTelemetry } from '../sim/client';
import type { SimConfig } from '../sim/worker';
import ConnectomeInspector from './ConnectomeInspector';

const W = 900;
const H = 600;
const AGENT_N = 40;

const SIM_CONFIG: SimConfig = {
  agentCount: AGENT_N,
  neuronsPerAgent: 32,
  worldW: W,
  worldH: H,
  scentSources: [W / 2, H / 2],
  obstacles: [],
};

interface Ripple {
  x: number;
  y: number;
  r: number;
  alpha: number;
  born: number;
}

function drawFly(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, hue: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = `hsla(${hue},75%,62%,0.92)`;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, 4.5);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-5, -4.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawReticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  now: number,
  agentIdx: number
) {
  const r = 14 + Math.sin(now * 0.008) * 1.5;

  ctx.save();
  ctx.translate(x, y);

  // Outer glowing halo
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  // Subtle corner crosshairs
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-r - 4, 0); ctx.lineTo(-r + 2, 0);
  ctx.moveTo(r - 2, 0);  ctx.lineTo(r + 4, 0);
  ctx.moveTo(0, -r - 4); ctx.lineTo(0, -r + 2);
  ctx.moveTo(0, r - 2);  ctx.lineTo(0, r + 4);
  ctx.stroke();

  // Heading vector
  ctx.save();
  ctx.rotate(angle);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(r + 9, 0);
  ctx.stroke();

  // Arrowhead
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.moveTo(r + 9, 0);
  ctx.lineTo(r + 5, -3);
  ctx.lineTo(r + 5, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Tag badge above (unrotated)
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`AGENT #${agentIdx.toString().padStart(2, '0')}`, 0, -r - 6);

  ctx.restore();
}

function drawScent(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number) {
  const pulse = 22 + Math.sin(t * 2.5) * 5;
  const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, pulse * 3.5);
  grad.addColorStop(0, 'rgba(255,210,50,0.95)');
  grad.addColorStop(0.35, 'rgba(255,140,20,0.45)');
  grad.addColorStop(1, 'rgba(255,100,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(sx, sy, pulse * 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe060';
  ctx.beginPath();
  ctx.arc(sx, sy, pulse * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function drawGrid(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

function makeSim(
  frameRef: React.MutableRefObject<Float32Array | null>,
  tickRef: React.MutableRefObject<number>,
  telemetryRef: React.MutableRefObject<InspectTelemetry | null>
): SimClient {
  const sim = new SimClient(SIM_CONFIG);
  sim.onFrame = (agents, tick) => {
    frameRef.current = agents;
    tickRef.current  = tick;
  };
  sim.onInspect = (data) => {
    telemetryRef.current = data;
  };
  sim.start();
  return sim;
}

export default function FlySimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<SimClient | null>(null);
  const frameRef = useRef<Float32Array | null>(null);
  const telemetryRef = useRef<InspectTelemetry | null>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const pausedRef = useRef(false);
  const scentRef = useRef<[number, number]>([W / 2, H / 2]);
  const rafRef = useRef(0);
  const tickRef = useRef(0);
  const fpsRef = useRef({ fps: 0, lastUpdate: 0, frameCount: 0 });

  const [isPaused, setIsPaused] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const selectedAgentRef = useRef<number | null>(null);

  useEffect(() => {
    selectedAgentRef.current = selectedAgent;
  }, [selectedAgent]);

  // ── render loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function loop(now: number) {
      if (!ctx) return;
      rafRef.current = requestAnimationFrame(loop);
      const t = now * 0.001;

      // FPS calculation
      const fps = fpsRef.current;
      fps.frameCount++;
      if (now - fps.lastUpdate > 500) {
        fps.fps = Math.round(fps.frameCount * 2);
        fps.frameCount = 0;
        fps.lastUpdate = now;
      }

      ctx.fillStyle = '#080c14';
      ctx.fillRect(0, 0, W, H);
      drawGrid(ctx);
      drawScent(ctx, scentRef.current[0], scentRef.current[1], t);

      // Ripple animation
      for (let i = ripplesRef.current.length - 1; i >= 0; i--) {
        const rp = ripplesRef.current[i];
        const age = (now - rp.born) / 700;
        if (age >= 1) { ripplesRef.current.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(255,210,50,${(1 - age) * 0.55})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, 8 + age * 60, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Agents
      const agents = frameRef.current;
      const curSelected = selectedAgentRef.current;
      if (agents) {
        const n = (agents.length / 3) | 0;
        for (let a = 0; a < n; a++) {
          const b = a * 3;
          const hue = ((agents[b + 2] * 57.3) + 200) % 360;
          drawFly(ctx, agents[b], agents[b + 1], agents[b + 2], hue);
        }

        // Highlight selected agent with targeting reticle
        if (curSelected !== null && curSelected >= 0 && curSelected < n) {
          const b = curSelected * 3;
          drawReticle(ctx, agents[b], agents[b + 1], agents[b + 2], now, curSelected);
        }
      }

      // HUD Overlay (Clean scientific instrumentation styling)
      ctx.fillStyle = 'rgba(8, 12, 20, 0.85)';
      ctx.fillRect(10, 10, 195, pausedRef.current ? 82 : 68);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.strokeRect(10, 10, 195, pausedRef.current ? 82 : 68);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`TICK     ${tickRef.current.toLocaleString('en-US')}`, 18, 30);
      ctx.fillText(`AGENTS   ${AGENT_N}`, 18, 47);
      ctx.fillText(`FPS      ${fps.fps}`, 18, 64);
      if (pausedRef.current) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillText('[PAUSED]', 18, 81);
      }
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── SimClient initialization ────────────────────────────────────────────────
  useEffect(() => {
    clientRef.current = makeSim(frameRef, tickRef, telemetryRef);
    return () => clientRef.current?.destroy();
  }, []);

  // ── Canvas click: Hit-testing or Scent relocation ────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);

    // Hit-test closest agent within 16px radius
    const agents = frameRef.current;
    let closestIdx = -1;
    let minDistSq = 16 * 16; // 256

    if (agents) {
      const n = (agents.length / 3) | 0;
      for (let a = 0; a < n; a++) {
        const b = a * 3;
        const dx = agents[b] - x;
        const dy = agents[b + 1] - y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) {
          minDistSq = distSq;
          closestIdx = a;
        }
      }
    }

    if (closestIdx !== -1) {
      // Agent selected -> start telemetry inspection
      setSelectedAgent(closestIdx);
      clientRef.current?.inspectAgent(closestIdx);
    } else {
      // Empty space -> relocate scent source
      scentRef.current = [x, y];
      clientRef.current?.setScent(x, y);
      ripplesRef.current.push({ x, y, r: 0, alpha: 0.6, born: performance.now() });
      if (ripplesRef.current.length > 8) ripplesRef.current.shift();
    }
  }, []);

  const handleDeselect = useCallback(() => {
    setSelectedAgent(null);
    telemetryRef.current = null;
    clientRef.current?.inspectAgent(-1);
  }, []);

  // ── Simulation controls ─────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    const sim = clientRef.current;
    if (!sim) return;
    setIsPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      if (next) {
        sim.pause();
      } else {
        sim.start();
      }
      return next;
    });
  }, []);

  const restart = useCallback(() => {
    clientRef.current?.destroy();
    pausedRef.current  = false;
    setIsPaused(false);
    setSelectedAgent(null);
    telemetryRef.current = null;
    frameRef.current   = null;
    ripplesRef.current = [];
    scentRef.current   = [W / 2, H / 2];
    tickRef.current    = 0;
    fpsRef.current     = { fps: 0, lastUpdate: 0, frameCount: 0 };
    clientRef.current  = makeSim(frameRef, tickRef, telemetryRef);
  }, []);

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerBadge}>COMPUTATIONAL NEUROSCIENCE WORKSTATION</div>
        <h1 style={s.title}>SYNAPSCAPE</h1>
        <p style={s.sub}>
          Drosophila-Inspired LIF Spiking Neural Simulation &middot; {AGENT_N} Agents &middot; Braitenberg Chemotaxis &middot; STDP Plasticity
        </p>
      </header>

      {/* Main Simulation Viewport & Inspector Sidebar */}
      <div style={s.stage}>
        <div style={s.wrap}>
          <canvas ref={canvasRef} width={W} height={H} onClick={handleClick} style={s.canvas} />
        </div>

        {selectedAgent !== null && (
          <ConnectomeInspector
            telemetryRef={telemetryRef}
            agentIndex={selectedAgent}
            onClose={handleDeselect}
          />
        )}
      </div>

      <div style={s.controls}>
        <button
          onClick={togglePause}
          style={{ ...s.btn, ...(isPaused ? s.btnGreen : {}) }}
          aria-label={isPaused ? 'Resume simulation' : 'Pause simulation'}
        >
          {isPaused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button onClick={restart} style={{ ...s.btn, ...s.btnGhost }}>
          ↺ Restart World
        </button>
        {selectedAgent !== null && (
          <button onClick={handleDeselect} style={{ ...s.btn, ...s.btnGhost, color: '#38bdf8' }}>
            Deselect Agent #{selectedAgent}
          </button>
        )}
        <span style={s.hint}>
          Left-click canvas to relocate odor plume &bull; Click an agent to inspect connectome
        </span>
      </div>

      {/* Scientific Overview Cards */}
      <section style={s.grid}>
        <Card tag="[LIF]" title="Leaky Integrate-and-Fire Dynamics">
          Each agent is driven by 32 biological point neurons. The sub-threshold membrane potential decays
          exponentially (&tau;<sub>m</sub> = 20 ms) toward resting potential (-65 mV). Crossing the -50 mV
          threshold triggers an action potential, followed by a 2 ms absolute refractory period.
        </Card>
        <Card tag="[BRAITENBERG]" title="Braitenberg Chemotaxis Reflex">
          Bilateral antennae project contralateral excitation to differential drive motors: Left Antenna
          (0..3) &rarr; Right Motor (31), Right Antenna (4..7) &rarr; Left Motor (30). Collision sensor (8)
          asymmetrically inhibits motors to generate innate obstacle avoidance and food-seeking tropotaxis.
        </Card>
        <Card tag="[STDP]" title="Synaptic STDP Plasticity">
          Recurrent interneuron weights (9..29) adapt continuously via Spike-Timing-Dependent Plasticity
          (Bi &amp; Poo, 1998). Synchronous pre- and post-synaptic firing induces Long-Term Potentiation (LTP),
          progressively refining foraging trajectories and sensory adaptation over time.
        </Card>
      </section>
    </div>
  );
}

function Card({ tag, title, children }: { tag: string; title: string; children: React.ReactNode }) {
  return (
    <div style={s.card}>
      <span style={s.cardTag}>{tag}</span>
      <h3 style={s.cardTitle}>{title}</h3>
      <p style={s.cardBody}>{children}</p>
    </div>
  );
}

const s = {
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 22,
    padding: '28px 16px 56px',
    background: '#05070d',
    minHeight: '100vh',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#cbd5e1',
  },
  header: {
    textAlign: 'center' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
  },
  headerBadge: {
    fontSize: 10,
    fontFamily: '"JetBrains Mono", monospace',
    letterSpacing: 1.5,
    color: '#64748b',
    border: '1px solid rgba(255,255,255,0.06)',
    padding: '3px 8px',
    borderRadius: 4,
    marginBottom: 4,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: 4,
    color: '#f8fafc',
    fontFamily: '"JetBrains Mono", monospace',
  },
  sub: {
    margin: '4px 0 0',
    fontSize: 12,
    color: '#64748b',
    letterSpacing: 0.3,
    fontFamily: '"JetBrains Mono", monospace',
  },
  stage: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 16,
    flexWrap: 'wrap' as const,
    maxWidth: '100%',
  },
  wrap: {
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 12px 48px rgba(0, 0, 0, 0.75)',
  },
  canvas: {
    display: 'block',
    cursor: 'crosshair',
    maxWidth: '100%',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap' as const,
  },
  btn: {
    padding: '7px 18px',
    background: '#0d131f',
    color: '#cbd5e1',
    borderWidth: 1,
    borderStyle: 'solid' as const,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: '"JetBrains Mono", monospace',
    transition: 'all 120ms ease',
  },
  btnGreen: {
    background: '#0c2417',
    borderColor: 'rgba(74,222,128,0.3)',
    color: '#4ade80',
  },
  btnGhost: {
    background: 'transparent',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  hint: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: '"JetBrains Mono", monospace',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 14,
    width: '100%',
    maxWidth: 960,
  },
  card: {
    background: '#080c14',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: '18px 20px',
  },
  cardTag: {
    display: 'inline-block',
    fontSize: 10,
    fontFamily: '"JetBrains Mono", monospace',
    color: '#38bdf8',
    letterSpacing: 1,
    marginBottom: 6,
  },
  cardTitle: {
    margin: '0 0 8px',
    fontSize: 13,
    fontWeight: 600,
    color: '#e2e8f0',
    fontFamily: '"JetBrains Mono", monospace',
  },
  cardBody: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.65,
    color: '#94a3b8',
  },
} as const;
