import { useEffect, useRef, useCallback, useState } from 'react';
import { SimClient } from '../sim/client';
import type { SimConfig } from '../sim/worker';

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

interface Ripple { x: number; y: number; r: number; alpha: number; born: number; }

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
): SimClient {
  const sim = new SimClient(SIM_CONFIG);
  sim.onFrame = (agents, tick) => {
    frameRef.current = agents;
    tickRef.current  = tick;
  };
  sim.start();
  return sim;
}

export default function FlySimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<SimClient | null>(null);
  const frameRef = useRef<Float32Array | null>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const pausedRef = useRef(false);
  const scentRef = useRef<[number, number]>([W / 2, H / 2]);
  const rafRef = useRef(0);
  const tickRef = useRef(0);  // csak ezt frissíti a Worker callback, nulla re-render
  const fpsRef = useRef({ fps: 0, lastUpdate: 0, frameCount: 0 });

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

      // FPS számítás – csak a számolás van throttle mögé, a rajzolás nem
      const fps = fpsRef.current;
      fps.frameCount++;
      if (now - fps.lastUpdate > 500) {
        fps.fps = Math.round(fps.frameCount * 2);
        fps.frameCount = 0;
        fps.lastUpdate = now;
      }

      ctx.fillStyle = '#0b0f17';
      ctx.fillRect(0, 0, W, H);
      drawGrid(ctx);
      drawScent(ctx, scentRef.current[0], scentRef.current[1], t);

      // Ripple animáció
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

      // Legyek
      const agents = frameRef.current;
      if (agents) {
        const n = (agents.length / 3) | 0;
        for (let a = 0; a < n; a++) {
          const b = a * 3;
          const hue = ((agents[b + 2] * 57.3) + 200) % 360;
          drawFly(ctx, agents[b], agents[b + 1], agents[b + 2], hue);
        }
      }

      // HUD – minden frame-ben rajzolódik (clearRect után), nincsen throttle!
      ctx.fillStyle = 'rgba(8,12,22,0.72)';
      ctx.fillRect(10, 10, 185, pausedRef.current ? 82 : 68);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '11px "JetBrains Mono", "Courier New", monospace';
      ctx.fillText(`tick    ${tickRef.current.toLocaleString('hu-HU')}`, 18, 30);
      ctx.fillText(`ágensek ${AGENT_N}`, 18, 47);
      ctx.fillText(`fps     ${fps.fps}`, 18, 64);
      if (pausedRef.current) {
        ctx.fillStyle = 'rgba(253,186,116,0.9)';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('⏸  SZÜNET', 18, 81);
      }
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── SimClient init ──────────────────────────────────────────────────────────
  useEffect(() => {
    clientRef.current = makeSim(frameRef, tickRef);
    return () => clientRef.current?.destroy();
  }, []);

  // ── canvas kattintás → szagforrás + ripple ─────────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    scentRef.current = [x, y];
    clientRef.current?.setScent(x, y);
    ripplesRef.current.push({ x, y, r: 0, alpha: 0.6, born: performance.now() });
    if (ripplesRef.current.length > 8) ripplesRef.current.shift();
  }, []);

  // ── vezérlők ───────────────────────────────────────────────────────────────
  const [isPaused, setIsPaused] = useState(false);

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
    frameRef.current   = null;
    ripplesRef.current = [];
    scentRef.current   = [W / 2, H / 2];
    tickRef.current    = 0;
    fpsRef.current     = { fps: 0, lastUpdate: 0, frameCount: 0 };
    clientRef.current  = makeSim(frameRef, tickRef);
  }, []);

  return (
    <div style={s.page}>
      <header style={s.header}>
        <h1 style={s.title}>Synapscape</h1>
        <p style={s.sub}>Drosophila-ihlette LIF neurális szimuláció &middot; {AGENT_N} ágens &middot; Braitenberg kemotaxis</p>
      </header>

      <div style={s.wrap}>
        <canvas ref={canvasRef} width={W} height={H} onClick={handleClick} style={s.canvas} />
      </div>

      <div style={s.controls}>
        <button
          onClick={togglePause}
          style={{ ...s.btn, ...(isPaused ? s.btnGreen : {}) }}
          aria-label={isPaused ? 'Szimuláció folytatása' : 'Szimuláció szüneteltetése'}
        >
          {isPaused ? '▶ Folytatás' : '⏸ Szünet'}
        </button>
        <button onClick={restart} style={{ ...s.btn, ...s.btnGhost }}>
          ↺ Újraindítás
        </button>
        <span style={s.hint}>Kattints a vászonra a szagforrás mozgatásához</span>
      </div>

      <section style={s.grid}>
        <Card icon="⚡" title="Leaky Integrate-and-Fire modell">
          Minden ágens agyát 32 neuron alkotja. A membránpotenciál exponenciálisan
          csökken (τ = 20 ms), és ha eléri a –50 mV küszöböt, a neuron kisül.
          A kisülés után 2 ms refrakter periódus véd a hiperkisüléstől.
        </Card>
        <Card icon="🧠" title="Braitenberg kemotaxis reflex">
          A bal antenna keresztezve a jobb motort gerjeszti, a jobb antenna a balt.
          Ez a bekötés biztosítja, hogy az ágens ösztönösen a szagforrás felé forduljon –
          tanulás előtt, veleszületett reflexként.
        </Card>
        <Card icon="🔗" title="STDP szinaptikus tanulás">
          A súlyokat Spike-Timing Dependent Plasticity alakítja (Bi & Poo, 1998):
          ha pre- és posztszinaptikus neuron egyszerre sül ki, az összeköttetés erősödik
          (LTP). Az ágensek ezáltal finomítják az élelmiszer-keresési stratégiájukat.
        </Card>
      </section>
    </div>
  );
}

function Card({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={s.card}>
      <span style={s.cardIcon}>{icon}</span>
      <h3 style={s.cardTitle}>{title}</h3>
      <p style={s.cardBody}>{children}</p>
    </div>
  );
}

const s = {
  page: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 24, padding: '32px 16px 56px', background: '#07090f', minHeight: '100vh', fontFamily: '"Inter","Segoe UI",sans-serif', color: '#c8cdd6' },
  header: { textAlign: 'center' as const },
  title: { margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: 3, background: 'linear-gradient(90deg,#ffd700,#ff8c00)', WebkitBackgroundClip: 'text' as const, WebkitTextFillColor: 'transparent' as const },
  sub: { margin: '6px 0 0', fontSize: 13, color: '#4b5563', letterSpacing: 0.4 },
  wrap: { borderRadius: 10, overflow: 'hidden', boxShadow: '0 0 0 1px rgba(255,215,0,0.15),0 12px 48px rgba(0,0,0,0.8)' },
  canvas: { display: 'block', cursor: 'crosshair', maxWidth: '100%' },
  controls: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const },
  // border shorthand és borderColor longhand nem keverhető React-ban – szétbontva:
  btn: { padding: '8px 22px', background: '#1a2030', color: '#c8cdd6', borderWidth: 1, borderStyle: 'solid' as const, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  btnGreen: { background: '#14391f', borderColor: 'rgba(74,222,128,0.25)', color: '#6ee7a0' },
  btnGhost: { background: 'transparent', borderColor: 'rgba(255,255,255,0.08)' },
  hint: { fontSize: 12, color: '#374151' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14, width: '100%', maxWidth: 960 },
  card: { background: '#0f1520', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '20px 22px' },
  cardIcon: { fontSize: 22 },
  cardTitle: { margin: '8px 0 6px', fontSize: 14, fontWeight: 600, color: '#e5e7eb' },
  cardBody: { margin: 0, fontSize: 13, lineHeight: 1.7, color: '#6b7280' },
} as const;
