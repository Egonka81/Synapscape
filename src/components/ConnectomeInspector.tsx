import { useEffect, useRef } from 'react';
import type { InspectTelemetry } from '../sim/client';

export interface ConnectomeInspectorProps {
  telemetryRef: React.MutableRefObject<InspectTelemetry | null>;
  agentIndex: number;
  onClose: () => void;
}

const W = 380;
const H = 640;
const N = 32;

// Precalculated node coordinates in the biological topology
interface NodePos {
  x: number;
  y: number;
  label: string;
  group: 'sensory-l' | 'sensory-r' | 'collision' | 'inter' | 'motor';
}

function computeNodeLayout(): NodePos[] {
  const nodes: NodePos[] = [];

  // Left Antenna: 0..3
  for (let i = 0; i < 4; i++) {
    nodes.push({
      x: 44,
      y: 30 + i * 22,
      label: `L${i}`,
      group: 'sensory-l',
    });
  }

  // Right Antenna: 4..7
  for (let i = 0; i < 4; i++) {
    nodes.push({
      x: 44,
      y: 130 + i * 22,
      label: `R${i}`,
      group: 'sensory-r',
    });
  }

  // Multi-Directional Collision Sensors: 8 (Front), 9 (Left), 10 (Right)
  nodes.push({
    x: 44,
    y: 232,
    label: 'CF',
    group: 'collision',
  });
  nodes.push({
    x: 44,
    y: 254,
    label: 'CL',
    group: 'collision',
  });
  nodes.push({
    x: 44,
    y: 276,
    label: 'CR',
    group: 'collision',
  });

  // Central Complex Recurrent Interneurons: 11..29 (19 nodes)
  const cx = 196;
  const cy = 152;
  const rx = 80;
  const ry = 114;
  for (let i = 11; i < 30; i++) {
    const k = i - 11;
    const angle = (k / 19) * Math.PI * 2 - Math.PI / 2;
    nodes.push({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      label: `${i}`,
      group: 'inter',
    });
  }

  // Motor Outputs: 30 (Motor L), 31 (Motor R)
  nodes.push({
    x: 336,
    y: 122,
    label: 'M-L',
    group: 'motor',
  });
  nodes.push({
    x: 336,
    y: 182,
    label: 'M-R',
    group: 'motor',
  });

  return nodes;
}

const NODES = computeNodeLayout();

export default function ConnectomeInspector({
  telemetryRef,
  agentIndex,
  onClose,
}: ConnectomeInspectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const glowRef = useRef<Float32Array>(new Float32Array(N));

  // Decoupled telemetry HUD cache (throttled text updates to eliminate 60 Hz flicker)
  const hudCacheRef = useRef({
    lastUpdate: 0,
    spikeHistory: [] as number[],
    activeSpikesText: '0.0 / 32',
    motorLeftText: 'IDLE (-0.1)',
    motorRightText: 'IDLE (-0.1)',
    meanWeightText: '0.00',
    deltaWeightText: 'Δw: 0.00 (+0 / -0)',
    tickText: '---',
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function render(now: number) {
      if (!ctx) return;
      rafRef.current = requestAnimationFrame(render);

      const telem = telemetryRef.current;
      const glows = glowRef.current;
      const hud = hudCacheRef.current;

      // 1. Smooth spike glow decay
      for (let i = 0; i < N; i++) {
        if (telem && telem.spikes[i]) {
          glows[i] = 1.0;
        } else {
          glows[i] = Math.max(0, glows[i] - 0.06);
        }
      }

      // 2. Throttled Telemetry Text Calculation (5-6 Hz)
      if (now - hud.lastUpdate > 180) {
        hud.lastUpdate = now;

        if (telem) {
          hud.tickText = telem.tick.toLocaleString('en-US');

          let currentSpikes = 0;
          for (let i = 0; i < N; i++) {
            if (telem.spikes[i]) currentSpikes++;
          }
          hud.spikeHistory.push(currentSpikes);
          if (hud.spikeHistory.length > 10) hud.spikeHistory.shift();

          const avgSpikes =
            hud.spikeHistory.reduce((acc, v) => acc + v, 0) /
            hud.spikeHistory.length;
          hud.activeSpikesText = `${avgSpikes.toFixed(1)} / 32`;

          const mLeft = telem.spikes[30];
          const mRight = telem.spikes[31];
          hud.motorLeftText = mLeft ? 'ACTUATING (+1.0)' : 'IDLE (-0.1)';
          hud.motorRightText = mRight ? 'ACTUATING (+1.0)' : 'IDLE (-0.1)';

          // Synaptic weight deltas (LTP vs LTD)
          if (telem.weights && telem.initialWeights) {
            let sumW = 0;
            let sumDelta = 0;
            let potentiated = 0;
            let depressed = 0;
            const len = telem.weights.length;
            for (let w = 0; w < len; w++) {
              const cur = telem.weights[w];
              const init = telem.initialWeights[w];
              const dw = cur - init;
              sumW += cur;
              sumDelta += dw;
              if (dw > 0.02) potentiated++;
              else if (dw < -0.02) depressed++;
            }
            hud.meanWeightText = (sumW / len).toFixed(2);
            hud.deltaWeightText = `Δw: ${(sumDelta / len).toFixed(3)} (+${potentiated} / -${depressed})`;
          }
        }
      }

      // Background clear
      ctx.fillStyle = '#080c14';
      ctx.fillRect(0, 0, W, H);

      // Grid background
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 305);
        ctx.stroke();
      }

      // ── Synaptic Connections (N x N Matrix Lines) ─────────────────────────
      if (telem && telem.weights) {
        const weights = telem.weights;
        for (let pre = 0; pre < N; pre++) {
          const preNode = NODES[pre];
          for (let post = 0; post < N; post++) {
            if (pre === post) continue;
            const w = weights[pre * N + post];
            if (Math.abs(w) < 1.2) continue; // Threshold for clarity

            const postNode = NODES[post];
            const isExcitatory = w > 0;
            const alpha = Math.min(0.7, (Math.abs(w) / 15.0) * 0.5 + 0.05);

            ctx.lineWidth = Math.min(2.5, Math.abs(w) * 0.22);
            ctx.strokeStyle = isExcitatory
              ? `rgba(56, 189, 248, ${alpha})`
              : `rgba(244, 63, 94, ${alpha * 0.8})`;

            ctx.beginPath();
            ctx.moveTo(preNode.x, preNode.y);
            ctx.lineTo(postNode.x, postNode.y);
            ctx.stroke();
          }
        }
      }

      // ── Connectome Nodes ──────────────────────────────────────────────────
      for (let i = 0; i < N; i++) {
        const node = NODES[i];
        const glow = glows[i];
        const v = telem ? telem.potentials[i] : -65.0;
        const normV = Math.max(0, Math.min(1, (v - -70.0) / 20.0));

        // Outer action potential flare
        if (glow > 0.05) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 10 + glow * 8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(56, 189, 248, ${glow * 0.45})`;
          ctx.fill();
        }

        // Inner node body
        ctx.beginPath();
        ctx.arc(node.x, node.y, 6.5, 0, Math.PI * 2);

        if (glow > 0.1) {
          ctx.fillStyle = '#ffffff';
        } else if (node.group === 'motor') {
          ctx.fillStyle = '#d97706';
        } else if (node.group === 'collision') {
          ctx.fillStyle = '#ef4444';
        } else if (node.group === 'sensory-l' || node.group === 'sensory-r') {
          ctx.fillStyle = '#0284c7';
        } else {
          // Interneuron shaded by membrane potential
          const r = Math.floor(30 + normV * 80);
          const g = Math.floor(41 + normV * 120);
          const b = Math.floor(59 + normV * 180);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        }
        ctx.fill();

        ctx.strokeStyle = glow > 0.1 ? '#38bdf8' : 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = glow > 0.1 ? 2 : 1;
        ctx.stroke();

        // Node index label
        ctx.fillStyle = glow > 0.1 ? '#f8fafc' : '#94a3b8';
        ctx.font = '8px "JetBrains Mono", "SF Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, node.x, node.y - 10);
      }

      // ── Sub-Threshold Membrane Potentials Bar Graph ───────────────────────
      const barY0 = 310;
      ctx.fillStyle = '#374151';
      ctx.font = '9px "JetBrains Mono", "SF Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('MEMBRANE POTENTIALS V(t) [-70mV .. -50mV]', 14, barY0 - 4);

      const barW = 8.5;
      const barGap = 2.4;
      const startX = 14;
      const maxBarH = 34;

      for (let i = 0; i < N; i++) {
        const v = telem ? telem.potentials[i] : -65.0;
        const normH = Math.max(0, Math.min(1, (v - -70.0) / 20.0));
        const curH = Math.max(2, normH * maxBarH);
        const bx = startX + i * (barW + barGap);
        const by = barY0 + maxBarH - curH;

        if (glows[i] > 0.3) {
          ctx.fillStyle = '#38bdf8'; // Spiking
        } else if (v >= -55.0) {
          ctx.fillStyle = '#f59e0b'; // Near threshold
        } else {
          ctx.fillStyle = '#1e293b'; // Subthreshold
        }
        ctx.fillRect(bx, by, barW, curH);

        ctx.fillStyle = glows[i] > 0.3 ? '#ffffff' : '#475569';
        ctx.fillRect(bx, by, barW, 1.5);
      }

      // ── Spike Raster Plot (120-Tick Window) ───────────────────────────────
      const rasterTop = 370;
      const rasterH = 68;
      const rasterW = W - 28;
      ctx.fillStyle = '#374151';
      ctx.font = '9px "JetBrains Mono", "SF Mono", monospace';
      ctx.fillText('SPIKE RASTER PLOT [120 TICKS × 32 NEURONS]', 14, rasterTop - 4);

      ctx.fillStyle = '#0b111e';
      ctx.fillRect(14, rasterTop, rasterW, rasterH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.strokeRect(14, rasterTop, rasterW, rasterH);

      if (telem && telem.spikeHistory) {
        const hist = telem.spikeHistory;
        const ticks = 120;
        const tickW = rasterW / ticks;
        const neuronH = rasterH / N;

        for (let t = 0; t < ticks; t++) {
          const tOffset = t * N;
          const rx = 14 + t * tickW;
          for (let n = 0; n < N; n++) {
            if (hist[tOffset + n] > 0.5) {
              const ry = rasterTop + n * neuronH;
              ctx.fillStyle = n >= 30 ? '#d97706' : n >= 8 && n <= 10 ? '#ef4444' : '#38bdf8';
              ctx.fillRect(rx, ry, Math.max(1.5, tickW), Math.max(1.5, neuronH));
            }
          }
        }
      }

      // ── Stabilized Telemetry Box (Jitter-Free 5-6 Hz Refresh) ─────────────
      const footTop = 464;
      ctx.fillStyle = '#374151';
      ctx.font = '9px "JetBrains Mono", "SF Mono", monospace';
      ctx.fillText('STDP PLASTICITY & MOTOR METRICS', 14, footTop - 4);

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(14, footTop, W - 28, 140);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.strokeRect(14, footTop, W - 28, 140);

      ctx.font = '10px "JetBrains Mono", "SF Mono", monospace';
      ctx.fillStyle = '#94a3b8';

      ctx.fillText(`CURRENT TICK   : ${hud.tickText}`, 26, footTop + 22);
      ctx.fillText(`ACTIVE SPIKES  : ${hud.activeSpikesText}`, 26, footTop + 42);
      ctx.fillText(`MOTOR L (N-2)  : ${hud.motorLeftText}`, 26, footTop + 62);
      ctx.fillText(`MOTOR R (N-1)  : ${hud.motorRightText}`, 26, footTop + 82);
      ctx.fillText(`MEAN WEIGHT    : ${hud.meanWeightText}`, 26, footTop + 102);
      ctx.fillText(`PLASTICITY     : ${hud.deltaWeightText}`, 26, footTop + 122);
    }

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [telemetryRef]);

  return (
    <aside style={s.panel} aria-label="Connectome Telemetry Inspector">
      <div style={s.header}>
        <div style={s.titleGroup}>
          <span style={s.badge}>LIVE INSPECTION</span>
          <h2 style={s.title}>AGENT #{agentIndex.toString().padStart(2, '0')}</h2>
        </div>
        <button
          onClick={onClose}
          style={s.closeBtn}
          title="Deselect and close inspector"
          aria-label="Close Inspector"
        >
          [CLOSE ×]
        </button>
      </div>

      <div style={s.canvasWrap}>
        <canvas ref={canvasRef} width={W} height={H} style={s.canvas} />
      </div>

      <div style={s.legend}>
        <span style={s.legendItem}>
          <span style={{ ...s.dot, background: '#0284c7' }} /> Olfactory (L/R)
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.dot, background: '#ef4444' }} /> Col (F/L/R)
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.dot, background: '#38bdf8' }} /> Inter (11-29)
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.dot, background: '#d97706' }} /> Motor
        </span>
      </div>
    </aside>
  );
}

const s = {
  panel: {
    width: W,
    background: '#080c14',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.65)',
    transition: 'border-color 150ms ease',
    fontVariantNumeric: 'tabular-nums',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    background: '#0b101c',
  },
  titleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    fontSize: 9,
    fontFamily: '"JetBrains Mono", "SF Mono", monospace',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: 1,
    padding: '2px 6px',
    borderRadius: 3,
    background: 'rgba(56, 189, 248, 0.12)',
    color: '#38bdf8',
    border: '1px solid rgba(56, 189, 248, 0.3)',
  },
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: '"JetBrains Mono", "SF Mono", monospace',
    fontVariantNumeric: 'tabular-nums',
    color: '#f1f5f9',
    letterSpacing: 0.5,
  },
  closeBtn: {
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: '"JetBrains Mono", "SF Mono", monospace',
    padding: '3px 8px',
    transition: 'all 120ms ease',
  },
  canvasWrap: {
    width: W,
    height: H,
    background: '#080c14',
    fontVariantNumeric: 'tabular-nums',
  },
  canvas: {
    display: 'block',
    width: W,
    height: H,
  },
  legend: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 14px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    background: '#070a10',
    fontSize: 9,
    fontFamily: '"JetBrains Mono", "SF Mono", monospace',
    fontVariantNumeric: 'tabular-nums',
    color: '#64748b',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    display: 'inline-block',
  },
} as const;
