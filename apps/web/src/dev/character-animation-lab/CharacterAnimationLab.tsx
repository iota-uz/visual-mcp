import { useEffect, useMemo, useRef, useState } from "react";
import { CharacterScene } from "../../../../worker/src/video/character-scene";
import type { LabTuning, ScenarioId } from "./scenarios";
import {
  buildCharacterScenario,
  clampLabFrame,
  defaultLabTuning,
  formatLabTime,
  LAB_FPS,
  scenarioCatalog,
} from "./scenarios";
import "./character-animation-lab.css";

export type CharacterAnimationLabProps = {
  scenarioId?: ScenarioId;
  durationFrames?: number;
  blendInFrames?: number;
  blendOutFrames?: number;
  intensity?: number;
  autoPlay?: boolean;
  onionSkin?: boolean;
};

const rates = [0.25, 0.5, 1, 1.5, 2] as const;

function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="cal-control">
      <span>{label}</span>
      <output>{step < 1 ? value.toFixed(2) : value}</output>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

export function CharacterAnimationLab({
  scenarioId = "idle-look-talk",
  durationFrames = defaultLabTuning.durationFrames,
  blendInFrames = defaultLabTuning.blendInFrames,
  blendOutFrames = defaultLabTuning.blendOutFrames,
  intensity = defaultLabTuning.intensity,
  autoPlay = true,
  onionSkin: initialOnionSkin = false,
}: CharacterAnimationLabProps) {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const [selectedId, setSelectedId] = useState<ScenarioId>(scenarioId),
    [tuning, setTuning] = useState<LabTuning>({
      durationFrames,
      blendInFrames,
      blendOutFrames,
      intensity,
    }),
    [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(autoPlay && !prefersReducedMotion),
    [rate, setRate] = useState<(typeof rates)[number]>(1),
    [onionSkin, setOnionSkin] = useState(initialOnionSkin),
    clock = useRef({ timestamp: 0, fractionalFrame: 0 });

  const scenario = useMemo(() => buildCharacterScenario(selectedId, tuning), [selectedId, tuning]);

  useEffect(() => setSelectedId(scenarioId), [scenarioId]);
  useEffect(
    () => setTuning({ durationFrames, blendInFrames, blendOutFrames, intensity }),
    [durationFrames, blendInFrames, blendOutFrames, intensity],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: selecting another scenario intentionally resets the transport.
  useEffect(() => {
    setFrame(0);
    setPlaying(autoPlay && !prefersReducedMotion);
    clock.current = { timestamp: 0, fractionalFrame: 0 };
  }, [selectedId, autoPlay, prefersReducedMotion]);

  useEffect(() => {
    if (!playing) return;
    let request = 0;
    const tick = (timestamp: number) => {
      const previous = clock.current.timestamp || timestamp,
        elapsed = Math.min(100, timestamp - previous),
        nextFraction = clock.current.fractionalFrame + (elapsed / 1000) * LAB_FPS * rate,
        wholeFrames = Math.floor(nextFraction);
      clock.current = { timestamp, fractionalFrame: nextFraction - wholeFrames };
      if (wholeFrames > 0)
        setFrame((current) => {
          const next = current + wholeFrames;
          if (next >= scenario.totalFrames) return 0;
          return next;
        });
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, rate, scenario.totalFrames]);

  const setTuningValue = (key: keyof LabTuning, value: number) =>
    setTuning((current) => ({ ...current, [key]: value }));
  const seek = (next: number) => {
    setPlaying(false);
    setFrame(clampLabFrame(next, scenario.totalFrames));
    clock.current = { timestamp: 0, fractionalFrame: 0 };
  };

  return (
    <main className="cal-shell">
      <header className="cal-header">
        <div>
          <p className="cal-kicker">Native character engine · 30 fps</p>
          <h1>Motion laboratory</h1>
          <p>{scenario.description}</p>
        </div>
        <div className="cal-readout" aria-live="polite">
          <span>FRAME</span>
          <strong>{String(frame).padStart(4, "0")}</strong>
          <code>{formatLabTime(frame)}</code>
        </div>
      </header>

      <div className="cal-workbench">
        <aside className="cal-scenarios" aria-label="Animation scenarios">
          {["Foundation", "Gesture", "Reaction", "Targeting", "Transitions"].map((group) => (
            <section key={group}>
              <h2>{group}</h2>
              {scenarioCatalog
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span>{item.label}</span>
                    <small>{item.description}</small>
                  </button>
                ))}
            </section>
          ))}
        </aside>

        <section className="cal-stage-column">
          <div className="cal-stage-wrap">
            <div className="cal-stage" data-testid="character-stage">
              <CharacterScene props={scenario.props} frame={frame} />
              {onionSkin && (
                <>
                  <div className="cal-ghost cal-ghost-before" aria-hidden="true">
                    <CharacterScene
                      props={scenario.props}
                      frame={clampLabFrame(frame - 6, scenario.totalFrames)}
                    />
                  </div>
                  <div className="cal-ghost cal-ghost-after" aria-hidden="true">
                    <CharacterScene
                      props={scenario.props}
                      frame={clampLabFrame(frame + 6, scenario.totalFrames)}
                    />
                  </div>
                </>
              )}
              <div className="cal-safe-frame" aria-hidden="true" />
            </div>
            <div className="cal-stage-badge">{scenario.label}</div>
          </div>

          <div className="cal-transport">
            <div className="cal-buttons">
              <button type="button" onClick={() => seek(0)} aria-label="Reset to first frame">
                ↺
              </button>
              <button type="button" onClick={() => seek(frame - 1)} aria-label="Previous frame">
                −1
              </button>
              <button
                className="cal-play"
                type="button"
                onClick={() => setPlaying((value) => !value)}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? "Ⅱ" : "▶"}
              </button>
              <button type="button" onClick={() => seek(frame + 1)} aria-label="Next frame">
                +1
              </button>
            </div>
            <fieldset className="cal-rate">
              <legend className="cal-visually-hidden">Playback rate</legend>
              {rates.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={rate === value}
                  onClick={() => setRate(value)}
                >
                  {value}×
                </button>
              ))}
            </fieldset>
          </div>

          <div className="cal-timeline">
            <div className="cal-ruler" aria-hidden="true">
              {scenario.phases.map((phase) => (
                <span
                  key={`${phase.frame}-${phase.label}`}
                  className={`cal-marker cal-marker-${phase.tone ?? "neutral"}`}
                  style={{
                    left: `${(phase.frame / Math.max(1, scenario.totalFrames - 1)) * 100}%`,
                  }}
                >
                  <i /> <b>{phase.label}</b>
                </span>
              ))}
            </div>
            <input
              aria-label="Animation frame"
              type="range"
              min="0"
              max={scenario.totalFrames - 1}
              value={frame}
              onChange={(event) => seek(Number(event.currentTarget.value))}
            />
            <div className="cal-timeline-meta">
              <span>0</span>
              <span>
                {scenario.totalFrames} frames · {(scenario.totalFrames / LAB_FPS).toFixed(2)}s
              </span>
            </div>
          </div>
        </section>

        <aside className="cal-inspector">
          <div className="cal-inspector-heading">
            <span>Performance</span>
            <strong>Live tuning</strong>
          </div>
          <NumberControl
            label="Duration"
            value={tuning.durationFrames}
            min={8}
            max={180}
            onChange={(value) => setTuningValue("durationFrames", value)}
          />
          <NumberControl
            label="Blend in"
            value={tuning.blendInFrames}
            min={0}
            max={45}
            onChange={(value) => setTuningValue("blendInFrames", value)}
          />
          <NumberControl
            label="Blend out"
            value={tuning.blendOutFrames}
            min={0}
            max={45}
            onChange={(value) => setTuningValue("blendOutFrames", value)}
          />
          <NumberControl
            label="Intensity"
            value={tuning.intensity}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => setTuningValue("intensity", value)}
          />
          <label className="cal-toggle">
            <input
              type="checkbox"
              checked={onionSkin}
              onChange={(event) => setOnionSkin(event.currentTarget.checked)}
            />
            <span>
              Onion skin <small>± 6 frames</small>
            </span>
          </label>
          <div className="cal-diagnostics">
            <span>Scene contract</span>
            <strong>character-scene@2</strong>
            <span>Renderer</span>
            <strong>Production SVG</strong>
            <span>Seed</span>
            <strong>{scenario.props.seed}</strong>
            <span>Actions</span>
            <strong>{scenario.props.actionOrder.length}</strong>
          </div>
          <p className="cal-note">
            Controls rebuild valid production props. Scrub frame-by-frame around phase markers to
            inspect easing and hand-offs.
          </p>
        </aside>
      </div>
    </main>
  );
}

export default CharacterAnimationLab;
