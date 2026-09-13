'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, ChevronDown, ChevronUp, AlertTriangle, Ship, Anchor, AlertCircle, Maximize2, Minimize2 } from 'lucide-react';

interface ScmPanelProps {
  data: any;
}

export default function ScmPanel({ data }: ScmPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [maximized, setMaximized] = useState(false);

  const suppliers = data.scm_suppliers || [];
  const suppliersWithIndicators = suppliers.filter((s: any) => (s.exposure_indicators || []).length > 0 || (s.active_threats || []).length > 0);

  const ports = data.maritime_ports || [];
  const congestedPorts = ports.filter((p: any) => typeof p.congestion === 'string' && p.congestion.startsWith('UNVALIDATED_') && p.congestion !== 'UNVALIDATED_LOW');

  const chokepoints = data.maritime_chokepoints || [];
  const observedChokes = chokepoints.filter((c: any) => (c.observed_vessels_nearby || 0) > 0);

  const marketAlerts = data.markets?.scm_alerts || [];

  const totalRisks = suppliersWithIndicators.length + congestedPorts.length + marketAlerts.length;

  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7, duration: 0.6 }} className="glass-panel p-3 pointer-events-auto mt-3 border border-[#00BCD4]/30" style={{ background: 'rgba(0, 188, 212, 0.05)' }}>
      <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-between w-full mb-2">
        <div className="flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-[#00BCD4]" />
          <span className="hud-text text-[12px] text-[var(--text-primary)]">SCM RISK COMMAND</span>
          {totalRisks > 0 && (
            <span className="gotham-tag gotham-tag--critical" style={{ fontSize: '7px', padding: '1px 4px' }}>{totalRisks} ALERTS</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {expanded ? <ChevronUp className="w-3 h-3 text-[var(--text-muted)]" /> : <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="space-y-3 mt-2 overflow-y-auto styled-scrollbar pr-1 flex-1 pb-4">

              {/* Market Alerts */}
              {marketAlerts.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <AlertCircle className="w-3 h-3 text-[#FF9500]" />
                    <span className="text-[9px] font-mono text-[#FF9500] tracking-widest font-bold">MARKET IMPACT ALERTS</span>
                  </div>
                  <div className="space-y-1">
                    {marketAlerts.map((alert: string, i: number) => (
                      <div key={i} className="px-2 py-1.5 rounded border border-[#FF9500] bg-[#FF9500]/10 text-[#FF9500] text-[9px] font-mono leading-tight shadow-[0_0_8px_rgba(255,149,0,0.15)]">
                        {alert}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suppliers */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="w-3 h-3 text-[#FF1744]" />
                  <span className="text-[9px] font-mono text-[var(--text-muted)] tracking-widest">SOURCE INDICATORS</span>
                </div>
                {suppliersWithIndicators.length === 0 ? (
                  <div className="text-[9px] font-mono text-[var(--text-muted)] px-2">No source-backed supplier exposure indicators returned.</div>
                ) : (
                  <div className="space-y-1">
                    {suppliersWithIndicators.map((s: any, i: number) => {
                      const threats = Array.isArray(s.active_threats) ? s.active_threats : [];
                      return (
                        <div key={i} className="px-2 py-1.5 rounded border border-[#FF1744]/40 bg-[#FF1744]/10">
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-[10px] font-mono font-bold text-[#FF1744]">{s.name}</span>
                            <span className="text-[8px] font-mono text-[#FF1744]/80">{s.city}</span>
                          </div>
                          <div className="text-[8px] font-mono text-[#E8E6E0]">{threats.join(' • ')}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Ports & Chokepoints */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Anchor className="w-3 h-3 text-[#FF9500]" />
                  <span className="text-[9px] font-mono text-[var(--text-muted)] tracking-widest">CONGESTED NODES</span>
                </div>
                {(congestedPorts.length === 0 && observedChokes.length === 0) ? (
                  <div className="text-[9px] font-mono text-[var(--text-muted)] px-2">No validated maritime congestion or chokepoint risk assessment available.</div>
                ) : (
                  <div className="space-y-1">
                    {observedChokes.map((c: any, i: number) => (
                      <div key={`c-${i}`} className="px-2 py-1.5 rounded hover:bg-white/5 transition-colors border-l-2 border-[#00BCD4]/40">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[10px] font-mono text-[#FF9500] font-bold">{c.name}</span>
                          <span className="text-[8px] font-mono font-bold px-1 rounded bg-[#00BCD4]/20 text-[#00BCD4]">{c.observed_vessels_nearby} OBS</span>
                        </div>
                        <div className="text-[8px] font-mono text-[#aaa]">{c.reference_context || c.traffic}</div>
                      </div>
                    ))}
                    {congestedPorts.map((p: any, i: number) => (
                      <div key={`p-${i}`} className="px-2 py-1.5 rounded hover:bg-white/5 transition-colors border-l-2" style={{ borderLeftColor: p.congestion === 'SEVERE' ? '#FF1744' : '#FF9500' }}>
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[10px] font-mono text-[#00BCD4]">{p.name}</span>
                          <span className="text-[8px] font-mono font-bold px-1 rounded" style={{ background: p.congestion === 'SEVERE' ? '#FF1744' : '#FF9500', color: '#000' }}>{p.congestion}</span>
                        </div>
                        <div className="flex justify-between items-center text-[8px] font-mono text-[#aaa]">
                          <span>DWELL: <span className="text-[#fff]">{p.dwell_time}</span></span>
                          <span>{p.volume.split(' | ')[1]}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
