"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  DemoShell,
  Pipeline,
  ResetButton,
  usePipelineRunner,
} from "./DemoShared";
import Icon from "./Icon";

const PHASES = [
  { id: "edit", label: "Steps" },
  { id: "compile", label: "Compile" },
  { id: "preview", label: "Preview" },
];

const COMPILE_STEPS = [
  { label: "Compiling step definitions", ms: 30 },
  { label: "Resolving target elements", ms: 55 },
  { label: "Calculating tooltip positions", ms: 40 },
  { label: "Tour ready", ms: 10 },
];

interface TourStep {
  name: string;
  target: string;
  tip: string;
}

const INITIAL_STEPS: TourStep[] = [
  {
    name: "Welcome banner",
    target: "header",
    tip: "Welcome to your new dashboard!",
  },
  {
    name: "Create project",
    target: "sidebar",
    tip: "Click here to start your first project",
  },
  {
    name: "Invite team",
    target: "avatar",
    tip: "Add your teammates to collaborate",
  },
];

interface TargetPos {
  top: string;
  left: string;
  width: string;
  height: string;
  tipAnchor: "bottom" | "right";
}

// Target positions in the mock UI (percentages of the dx-mock-body)
const TARGET_POS: Record<string, TargetPos> = {
  header: {
    top: "4%",
    left: "50%",
    width: "92%",
    height: "32px",
    tipAnchor: "bottom",
  },
  sidebar: {
    top: "40%",
    left: "6%",
    width: "110px",
    height: "36px",
    tipAnchor: "right",
  },
  avatar: {
    top: "4%",
    left: "92%",
    width: "28px",
    height: "28px",
    tipAnchor: "bottom",
  },
};

export default function OnboardKitDemo() {
  const [phase, setPhase] = useState<string>("edit");
  const [steps, setSteps] = useState<TourStep[]>(INITIAL_STEPS);
  const [compileStep, setCompileStep] = useState<number>(-1);
  const [ready, setReady] = useState<boolean>(false);
  const [tourIdx, setTourIdx] = useState<number>(0);
  const [tourDone, setTourDone] = useState<boolean>(false);

  const { run, clear } = usePipelineRunner();

  function updateStep(i: number, patch: Partial<TourStep>) {
    setSteps((arr) => arr.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeStep(i: number) {
    setSteps((arr) => arr.filter((_, idx) => idx !== i));
  }
  function addStep() {
    setSteps((arr) => [
      ...arr,
      { name: `Step ${arr.length + 1}`, target: "header", tip: "Tooltip text…" },
    ]);
  }

  function compile() {
    setReady(false);
    setTourIdx(0);
    setTourDone(false);
    setPhase("compile");
    run(COMPILE_STEPS, setCompileStep, () => {
      setReady(true);
      setPhase("preview");
    });
  }

  function next() {
    if (tourIdx < steps.length - 1) setTourIdx(tourIdx + 1);
    else setTourDone(true);
  }
  function prev() {
    if (tourIdx > 0) setTourIdx(tourIdx - 1);
  }

  function reset() {
    clear();
    setPhase("edit");
    setCompileStep(-1);
    setReady(false);
    setTourIdx(0);
    setTourDone(false);
  }

  const activeStep = steps[tourIdx];
  const targetPos = activeStep
    ? TARGET_POS[activeStep.target] || TARGET_POS.header
    : null;

  return (
    <div className="kc-demo-scope">
      <DemoShell phases={PHASES} currentPhase={phase} height={620}>
        {phase === "edit" && (
          <div className="vv-phase-body">
            <div className="ok-steps">
              {steps.map((s, i) => (
                <div key={i} className="ok-step-row">
                  <span className="ok-step-num">{i + 1}</span>
                  <input
                    className="dx-field-input"
                    value={s.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateStep(i, { name: e.target.value })
                    }
                    style={{ flex: 1.4 }}
                  />
                  <select
                    className="dx-field-select"
                    value={s.target}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                      updateStep(i, { target: e.target.value })
                    }
                    style={{ flex: 0.8 }}
                  >
                    <option value="header">header</option>
                    <option value="sidebar">sidebar</option>
                    <option value="avatar">avatar</option>
                  </select>
                  <input
                    className="dx-field-input"
                    value={s.tip}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateStep(i, { tip: e.target.value })
                    }
                    style={{ flex: 2 }}
                    placeholder="Tooltip text"
                  />
                  <button
                    className="ok-remove"
                    onClick={() => removeStep(i)}
                    title="Remove"
                  >
                    <Icon name="x" size={11} stroke={2.6} />
                  </button>
                </div>
              ))}
              <button
                className="ok-add"
                onClick={addStep}
                disabled={steps.length >= 5}
              >
                <Icon name="plus" size={11} stroke={2.4} /> Add step
              </button>
            </div>
            <div className="dx-phase-footer">
              <span className="dx-helper">
                {steps.length} step{steps.length === 1 ? "" : "s"} configured
              </span>
              <button
                className="btn btn-vermillion"
                onClick={compile}
                disabled={steps.length === 0}
              >
                Preview tour <Icon name="arrow-right" size={13} />
              </button>
            </div>
          </div>
        )}

        {phase === "compile" && (
          <div className="vv-phase-body">
            <Pipeline
              steps={COMPILE_STEPS}
              currentIdx={compileStep}
              complete={ready}
            />
          </div>
        )}

        {phase === "preview" && (
          <div className="vv-phase-body">
            <div className="dx-mock-window">
              <div className="dx-mock-chrome">
                <span className="dot r" />
                <span className="dot y" />
                <span className="dot g" />
                <span className="url">yourapp.com/dashboard</span>
              </div>
              <div className="dx-mock-body ok-mock">
                <div className="ok-mock-header">
                  <span
                    style={{
                      fontFamily: "Inter Tight, sans-serif",
                      fontWeight: 700,
                      fontSize: 12,
                      color: "var(--ink-2)",
                    }}
                  >
                    Dashboard
                  </span>
                  <span className="ok-mock-avatar">A</span>
                </div>
                <div className="ok-mock-sidebar">
                  <div className="ok-mock-side-item">Projects</div>
                  <div className="ok-mock-side-item">Team</div>
                  <div className="ok-mock-side-item">Settings</div>
                  <div className="ok-mock-side-item primary">+ New project</div>
                </div>
                <div className="ok-mock-content">
                  <div className="ok-placeholder" style={{ height: 60 }} />
                  <div className="ok-placeholder" style={{ height: 90 }} />
                </div>

                {/* Spotlight + tooltip */}
                {!tourDone && activeStep && targetPos && (
                  <>
                    <motion.div
                      key={`spot-${tourIdx}`}
                      className="ok-spotlight"
                      style={{
                        top: targetPos.top,
                        left: targetPos.left,
                        width: targetPos.width,
                        height: targetPos.height,
                      }}
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.28 }}
                    />
                    <motion.div
                      key={`tip-${tourIdx}`}
                      className="ok-tip"
                      style={{
                        top: `calc(${targetPos.top} + ${
                          targetPos.tipAnchor === "bottom" ? "44px" : "0"
                        })`,
                        left:
                          targetPos.tipAnchor === "right"
                            ? `calc(${targetPos.left} + 64px)`
                            : targetPos.left,
                        transform:
                          targetPos.tipAnchor === "right"
                            ? "translate(0, -50%)"
                            : "translate(-50%, 0)",
                      }}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, delay: 0.1 }}
                    >
                      <div className="ok-tip-num">
                        {tourIdx + 1}/{steps.length}
                      </div>
                      <div className="ok-tip-body">{activeStep.tip}</div>
                      <div className="ok-tip-actions">
                        {tourIdx > 0 && <button onClick={prev}>Previous</button>}
                        <button className="primary" onClick={next}>
                          {tourIdx === steps.length - 1 ? "Finish" : "Next →"}
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}

                {tourDone && (
                  <motion.div
                    className="ok-complete"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                  >
                    <div className="ok-complete-icon">
                      <Icon name="check" size={20} stroke={3} color="#fff" />
                    </div>
                    <div className="ok-complete-title">Tour complete</div>
                    <div className="ok-complete-sub">
                      All {steps.length} steps completed
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            <div className="ok-analytics">
              <div className="ok-stat">
                <div className="ok-stat-v">73%</div>
                <div className="ok-stat-k">Completion</div>
              </div>
              <div className="ok-stat">
                <div className="ok-stat-v">45s</div>
                <div className="ok-stat-k">Avg time</div>
              </div>
              <div className="ok-stat">
                <div className="ok-stat-v">12%</div>
                <div className="ok-stat-k">Drop-off step 2</div>
              </div>
            </div>

            <div className="dx-phase-footer">
              <ResetButton onClick={reset} label="Edit steps" />
            </div>
          </div>
        )}
      </DemoShell>
    </div>
  );
}
