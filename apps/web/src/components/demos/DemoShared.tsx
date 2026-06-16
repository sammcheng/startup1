"use client";

// Ported from kc:frontend/src/components/DemoShared.jsx.
// The Pipeline / Crumb / PhaseStage / DemoShell / usePipelineRunner /
// ResetButton / SummaryLine primitives are the shared design vocabulary
// every interactive demo composes from.
//
// Styling lives in apps/web/src/app/globals.css under the `vv-*` and `dx-*`
// prefixes (added in this phase).

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import Icon, { type IconName } from "./Icon";

export interface PipelineStep {
  label: string;
  ms: number;
}

interface PipelineProps {
  steps: PipelineStep[];
  currentIdx: number;
  complete: boolean;
  labelOverride?: Record<number, string>;
}

export function Pipeline({
  steps,
  currentIdx,
  complete,
  labelOverride,
}: PipelineProps) {
  const labelFor = (s: PipelineStep, i: number) =>
    (labelOverride && labelOverride[i]) || s.label;
  const totalMs = steps
    .slice(0, Math.min(currentIdx, steps.length))
    .reduce((sum, x) => sum + x.ms, 0);
  const activeIdx =
    !complete && currentIdx >= 0 && currentIdx < steps.length ? currentIdx : -1;
  const activeStep = activeIdx >= 0 ? steps[activeIdx] : null;

  return (
    <div className="vv-pipe">
      <div className="vv-pipe-row">
        {steps.map((s, i) => {
          const done = i < currentIdx;
          return (
            <span
              key={i}
              className={`vv-pipe-dot ${done ? "done" : ""}`}
              data-label={labelFor(s, i)}
              data-ms={`${s.ms}ms`}
              aria-label={`${labelFor(s, i)} — ${s.ms}ms`}
              tabIndex={done ? 0 : -1}
            />
          );
        })}
        {complete && <span className="vv-pipe-total">{totalMs}ms</span>}
      </div>

      {activeStep && (
        <div className="vv-pipe-active-line">
          <span className="vv-spinner" />
          <span className="vv-pipe-active-label">
            {labelFor(activeStep, activeIdx)}
          </span>
          <span className="vv-pipe-active-ms">{activeStep.ms}ms</span>
        </div>
      )}
    </div>
  );
}

export interface Phase {
  id: string;
  label: string;
}

interface CrumbProps {
  phases: Phase[];
  currentPhase: string;
}

export function Crumb({ phases, currentPhase }: CrumbProps) {
  const idx = phases.findIndex((p) => p.id === currentPhase);
  return (
    <div className="vv-crumb">
      {phases.map((p, i) => (
        <span
          key={p.id}
          style={{ display: "inline-flex", alignItems: "center", gap: 12 }}
        >
          {i > 0 && <span className="vv-crumb-sep" />}
          <span
            className={`vv-crumb-step ${
              i < idx ? "done" : i === idx ? "active" : ""
            }`}
          >
            <span className="vv-crumb-num">{i + 1}</span>
            <span>{p.label}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

const phaseFade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.28, ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number] },
};

interface PhaseStageProps {
  phase: string;
  children: ReactNode;
  height?: number;
}

export function PhaseStage({ phase, children, height = 540 }: PhaseStageProps) {
  return (
    <div className="vv-stage" style={{ minHeight: height, maxHeight: height }}>
      <AnimatePresence mode="wait">
        <motion.div key={phase} className="vv-phase" {...phaseFade}>
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

interface DemoShellProps {
  phases: Phase[];
  currentPhase: string;
  height?: number;
  children: ReactNode;
}

export function DemoShell({
  phases,
  currentPhase,
  height = 540,
  children,
}: DemoShellProps) {
  return (
    <div className="vv-demo">
      <Crumb phases={phases} currentPhase={currentPhase} />
      <PhaseStage phase={currentPhase} height={height}>
        {children}
      </PhaseStage>
    </div>
  );
}

// Demo pacing — global tuning so users can actually read each phase.
// Each step waits at least MIN_STEP_MS, and the final phase holds for an
// extra END_PAUSE_MS before onComplete fires.
const MIN_STEP_MS = 1600;
const STEP_SCALE = 2.2;
const END_PAUSE_MS = 1000;

function paceStep(ms: number): number {
  return Math.max(MIN_STEP_MS, Math.round(ms * STEP_SCALE));
}

export function usePipelineRunner() {
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clear(), [clear]);

  const run = useCallback((
    steps: PipelineStep[],
    onStepChange: (idx: number) => void,
    onComplete?: () => void,
  ) => {
    clear();
    onStepChange(0);
    let cumulative = 0;
    steps.forEach((s, i) => {
      cumulative += paceStep(s.ms);
      timersRef.current.push(
        setTimeout(() => onStepChange(i + 1), cumulative),
      );
    });
    timersRef.current.push(
      setTimeout(() => onComplete?.(), cumulative + END_PAUSE_MS),
    );
  }, [clear]);

  return { run, clear };
}

interface ResetButtonProps {
  onClick: () => void;
  label?: string;
  icon?: IconName;
}

export function ResetButton({
  onClick,
  label = "Reset",
  icon = "arrow-left",
}: ResetButtonProps) {
  return (
    <button className="btn btn-ghost btn-sm dx-reset" onClick={onClick}>
      <Icon name={icon} size={12} /> {label}
    </button>
  );
}

interface SummaryLineProps {
  k: string;
  v: ReactNode;
  success?: boolean;
}

export function SummaryLine({ k, v, success }: SummaryLineProps) {
  return (
    <div
      className={`vv-summary-line ${
        success ? "vv-summary-line-success" : ""
      }`}
    >
      <span className="vv-summary-k">{k}</span>
      <span className="vv-summary-v">{v}</span>
    </div>
  );
}
