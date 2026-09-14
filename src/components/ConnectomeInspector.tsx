import { useEffect, useRef } from 'react';
import type { InspectTelemetry } from '../sim/client';

export interface ConnectomeInspectorProps {
  telemetryRef: React.MutableRefObject<InspectTelemetry | null>;
  agentIndex: number;
  onClose: () => void;
}

const W = 380;
const H = 580;
const N = 32;

// Precalculated node coordinates in the 3-layer topology
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
      y: 38 + i * 26,
      label: `L${i}`,
      group: 'sensory-l',
    });
  }

  // Right Antenna: 4..7
  for (let i = 0; i < 4; i++) {
    nodes.push({
      x: 44,
      y: 162 + i * 26,
      label: `R${i}`,
      group: 'sensory-r',
    });
  }

  // Collision Sensor: 8
  nodes.push({
    x: 44,
    y: 286,
    label: 'COL',
    group: 'collision',
  });

  // Interneurons (Central Complex ring): 9..29 (21 nodes)
  const cx = 196;
  const cy = 162;
  const rx = 80;
  const ry = 118;
  for (let i = 9; i < 30; i++) {
    const k = i - 9;
    const angle = (k / 21) * Math.PI * 2 - Math.PI / 2;
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
    y: 130,
    label: 'M-L',
    group: 'motor',
  });
  nodes.push({
    x: 336,
    y: 194,
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function render() {
      if (!ctx) return;
      rafRef.current = requestAnimationFrame(render);

      const telem = telemetryRef.current;
      const glows = glowRef.current;

      // Update phosphor glow decay
      if (telem) {
        for (let i = 0; i < N; i++) {
          const spike = telem.spikes[i] > 0.5 ? 1.0 : 0.0;
          glows[i] = Math.max(spike, glows[i] * 0.82);
        }
      } else {
        glows.fill(0);
      }

      // Background
      ctx.fillStyle = '#080c14';
      ctx.fillRect(0, 0, W, H);

      // Section Header: Topological Graph
      ctx.fillStyle = '#374151';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText('TOPOLOGICAL CONNECTOME GRAPH (32 NODES)', 14, 18);

      ctx.fillStyle = '#1f293d';
      ctx.fillRect(14, 24, W - 28, 1);

      // Draw Synaptic Connections
      if (telem && telem.weights) {
        const weights = telem.weights;
        for (let pre = 0; pre < N; pre++) {
          const p1 = NODES[pre];
          const row = pre * N;
          for (let post = 0; post < N; post++) {
            if (pre === post) continue;
            const w = weights[row + post];
            const absW = Math.abs(w);
            if (absW < 0.6) continue; // prune clutter for visual clarity

            const p2 = NODES[post];
            const alpha = Math.min(0.7, absW / 12.0);

            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            // Slight curve toward center
            const midX = (p1.x + p2.x) * 0.5;
            const midY = (p1.y + p2.y) * 0.5;
            ctx.lineTo(midX, midY);
            ctx.lineTo(p2.x, p2.y);

            if (w > 0) {
              ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`; // Cyan excitatory
            } else {
              ctx.strokeStyle = `rgba(244, 63, 94, ${alpha})`; // Coral inhibitory
            }
            ctx.lineWidth = Math.min(2.0, 0.5 + absW * 0.15);
            ctx.stroke();
          }
        }
      }

      // Draw Nodes
      for (let i = 0; i < N; i++) {
        const node = NODES[i];
        const glow = glows[i];

        // Base node ring
        ctx.beginPath();
        const baseR = node.group === 'inter' ? 5.5 : 7;
        ctx.arc(node.x, node.y, baseR, 0, Math.PI * 2);

        if (node.group === 'sensory-l' || node.group === 'sensory-r') {
          ctx.fillStyle = '#0e2433';
          ctx.strokeStyle = '#0284c7';
        } else if (node.group === 'collision') {
          ctx.fillStyle = '#2d1417';
          ctx.strokeStyle = '#e11d48';
        } else if (node.group === 'motor') {
          ctx.fillStyle = '#261b0c';
          ctx.strokeStyle = '#d97706';
        } else {
          ctx.fillStyle = '#0f172a';
          ctx.strokeStyle = '#334155';
        }
        ctx.lineWidth = 1.2;
        ctx.fill();
        ctx.stroke();

        // Active Spike Flash / Bioluminescent Halo
        if (glow > 0.05) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, baseR + glow * 5.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${glow * 0.95})`;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(node.x, node.y, baseR + glow * 9.0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(56, 189, 248, ${glow * 0.75})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Monospace Node Label
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillStyle = glow > 0.4 ? '#ffffff' : '#64748b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (node.group === 'inter') {
          ctx.fillText(node.label, node.x, node.y);
        } else if (node.group.startsWith('sensory') || node.group === 'collision') {
          ctx.textAlign = 'right';
          ctx.fillText(node.label, node.x - 10, node.y);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(node.label, node.x + 10, node.y);
        }
      }

      // ── Voltage Sparkline Section ──────────────────────────────────────────
      const voltTop = 330;
      ctx.fillStyle = '#374151';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('MEMBRANE POTENTIAL (Vm) [-70 mV ... -50 mV]', 14, voltTop);

      ctx.fillStyle = '#1f293d';
      ctx.fillRect(14, voltTop + 6, W - 28, 1);

      const barY0 = voltTop + 85;
      const barH = 65;
      const barW = 8;
      const barGap = 2.8;
      const startX = 14;

      // Threshold line (-50 mV)
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(startX, barY0 - barH);
      ctx.lineTo(startX + N * (barW + barGap), barY0 - barH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Resting line (-65 mV)
      const restY = barY0 - barH * ((-65 - -70) / 20);
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.25)';
      ctx.beginPath();
      ctx.moveTo(startX, restY);
      ctx.lineTo(startX + N * (barW + barGap), restY);
      ctx.stroke();

      const potentials = telem?.potentials;
      for (let i = 0; i < N; i++) {
        const bx = startX + i * (barW + barGap);
        const v = potentials ? potentials[i] : -65.0;
        // Normalize: -70 mV -> 0, -50 mV -> 1
        const norm = Math.max(0, Math.min(1.0, (v - -70.0) / 20.0));
        const curH = Math.max(3, norm * barH);
        const by = barY0 - curH;

        if (glows[i] > 0.3) {
          ctx.fillStyle = '#38bdf8'; // Spiking
        } else if (v >= -55.0) {
          ctx.fillStyle = '#f59e0b'; // Near threshold
        } else {
          ctx.fillStyle = '#1e293b'; // Subthreshold
        }
        ctx.fillRect(bx, by, barW, curH);

        // Subthreshold cap
        ctx.fillStyle = glows[i] > 0.3 ? '#ffffff' : '#475569';
        ctx.fillRect(bx, by, barW, 1.5);
      }

      // X-axis index labels
      ctx.fillStyle = '#4b5563';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('0', startX, barY0 + 13);
      ctx.fillText('8', startX + 8 * (barW + barGap), barY0 + 13);
      ctx.fillText('16', startX + 16 * (barW + barGap), barY0 + 13);
      ctx.fillText('24', startX + 24 * (barW + barGap), barY0 + 13);
      ctx.fillText('31', startX + 31 * (barW + barGap), barY0 + 13);

      // ── Real-Time Metrics Footer ───────────────────────────────────────────
      const footTop = 450;
      ctx.fillStyle = '#374151';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText('NEURAL CIRCUIT TELEMETRY', 14, footTop);

      ctx.fillStyle = '#1f293d';
      ctx.fillRect(14, footTop + 6, W - 28, 1);

      let activeSpikes = 0;
      if (telem) {
        for (let i = 0; i < N; i++) {
          if (telem.spikes[i] > 0.5) activeSpikes++;
        }
      }

      const mLeft = telem && telem.spikes[30] > 0.5 ? 'ON (1.0)' : 'IDLE (-0.1)';
      const mRight = telem && telem.spikes[31] > 0.5 ? 'ON (1.0)' : 'IDLE (-0.1)';

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(14, footTop + 14, W - 28, 90);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.strokeRect(14, footTop + 14, W - 28, 90);

      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#94a3b8';

      ctx.fillText(`ACTIVE SPIKES : ${activeSpikes} / 32`, 26, footTop + 34);
      ctx.fillText(`MOTOR L (N-2) : ${mLeft}`, 26, footTop + 52);
      ctx.fillText(`MOTOR R (N-1) : ${mRight}`, 26, footTop + 70);
      ctx.fillText(`CURRENT TICK  : ${telem ? telem.tick.toLocaleString() : '---'}`, 26, footTop + 88);
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
          <span style={{ ...s.dot, background: '#0284c7' }} /> Sensory (L/R)
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.dot, background: '#38bdf8' }} /> Excitatory (+)
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.dot, background: '#f43f5e' }} /> Inhibitory (-)
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
    fontFamily: '"JetBrains Mono", monospace',
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
    fontFamily: '"JetBrains Mono", monospace',
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
    fontFamily: '"JetBrains Mono", monospace',
    padding: '3px 8px',
    transition: 'all 120ms ease',
  },
  canvasWrap: {
    width: W,
    height: H,
    background: '#080c14',
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
    fontFamily: '"JetBrains Mono", monospace',
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
