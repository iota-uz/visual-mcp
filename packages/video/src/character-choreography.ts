import type { z } from "zod";
import { CharacterAction, VideoTimebase } from "./character.js";
import {
  type CharacterActionLibrarySnapshot,
  type CharacterActionReference,
  type CharacterActionTemplate,
  expandActionReference,
} from "./character-action-library.js";

type Placement =
  | { kind: "at"; seconds: number }
  | { kind: "after"; id: string; seconds: number }
  | { kind: "with"; id: string; seconds: number };
export type ChoreographyStep = {
  id: string;
  actorId: string;
  durationSeconds?: number;
  placement: Placement;
  holdSeconds: number;
  action: CharacterActionTemplate | { ref: CharacterActionReference };
};
export type CompiledChoreography = {
  timebase: z.infer<typeof VideoTimebase>;
  actionOrder: string[];
  actionsById: Record<string, CharacterAction>;
};

const finiteSeconds = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0 || value > 2400)
    throw new Error(`${label} must be finite and between 0 and 2400 seconds`);
  return value;
};

export class CharacterChoreographyBuilder {
  readonly #timebase: z.infer<typeof VideoTimebase>;
  readonly #library?: CharacterActionLibrarySnapshot;
  readonly #steps: ChoreographyStep[] = [];
  #pending?: ChoreographyStep;
  constructor(timebase: z.input<typeof VideoTimebase>, library?: CharacterActionLibrarySnapshot) {
    this.#timebase = VideoTimebase.parse(timebase);
    this.#library = library;
  }
  at(seconds: number) {
    return this.#place({ kind: "at", seconds: finiteSeconds(seconds, "at") });
  }
  after(id: string, seconds = 0) {
    return this.#place({ kind: "after", id, seconds: finiteSeconds(seconds, "after offset") });
  }
  with(id: string, seconds = 0) {
    return this.#place({ kind: "with", id, seconds: finiteSeconds(seconds, "with offset") });
  }
  #place(placement: Placement) {
    if (this.#pending) throw new Error("Previous placement is missing an action");
    this.#pending = {
      id: "",
      actorId: "",
      durationSeconds: 0,
      placement,
      holdSeconds: 0,
      action: {} as CharacterActionTemplate,
    };
    return this;
  }
  do(id: string, actorId: string, durationSeconds: number, action: CharacterActionTemplate) {
    if (!this.#pending) throw new Error("Call at(), after(), or with() before do()");
    this.#pending = {
      ...this.#pending,
      id,
      actorId,
      durationSeconds: finiteSeconds(durationSeconds, "duration"),
      action,
    };
    if (durationSeconds <= 0) throw new Error("duration must be greater than zero");
    this.#steps.push(this.#pending);
    this.#pending = undefined;
    return this;
  }
  use(id: string, actorId: string, ref: CharacterActionReference) {
    if (!this.#pending) throw new Error("Call at(), after(), or with() before use()");
    this.#pending = { ...this.#pending, id, actorId, durationSeconds: undefined, action: { ref } };
    this.#steps.push(this.#pending);
    this.#pending = undefined;
    return this;
  }
  hold(seconds: number) {
    const last = this.#steps.at(-1);
    if (!last) throw new Error("hold() requires a preceding action");
    last.holdSeconds = finiteSeconds(seconds, "hold");
    return this;
  }
  compile(): CompiledChoreography {
    if (this.#pending) throw new Error("Placement is missing an action");
    return compileCharacterChoreography(
      { timebase: this.#timebase, steps: this.#steps },
      this.#library,
    );
  }
}

export function choreography(
  timebase: z.input<typeof VideoTimebase>,
  library?: CharacterActionLibrarySnapshot,
) {
  return new CharacterChoreographyBuilder(timebase, library);
}

export function compileCharacterChoreography(
  input: { timebase: z.input<typeof VideoTimebase>; steps: readonly ChoreographyStep[] },
  library?: CharacterActionLibrarySnapshot,
): CompiledChoreography {
  const timebase = VideoTimebase.parse(input.timebase),
    fps = timebase.numerator / timebase.denominator;
  const frame = (seconds: number) => Math.round(finiteSeconds(seconds, "time") * fps);
  const resolved = new Map<string, { start: number; end: number }>();
  const visiting = new Set<string>();
  const ids = new Map(input.steps.map((step) => [step.id, step]));
  if (ids.size !== input.steps.length) throw new Error("Choreography action IDs must be unique");
  const resolve = (id: string): { start: number; end: number } => {
    const cached = resolved.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new Error(`Relative choreography cycle at ${id}`);
    const step = ids.get(id);
    if (!step) throw new Error(`Unknown relative action: ${id}`);
    visiting.add(id);
    let start: number;
    if (step.placement.kind === "at") start = frame(step.placement.seconds);
    else {
      const anchor = resolve(step.placement.id);
      start =
        (step.placement.kind === "after" ? anchor.end : anchor.start) +
        frame(step.placement.seconds);
    }
    const durationSeconds =
      "ref" in step.action
        ? library
          ? expandActionReference(library, step.action.ref).durationSeconds
          : (() => {
              throw new Error("Action reference requires a library snapshot");
            })()
        : step.durationSeconds;
    if (durationSeconds === undefined)
      throw new Error(`Inline action ${id} requires durationSeconds`);
    const value = { start, end: start + frame(durationSeconds + step.holdSeconds) };
    visiting.delete(id);
    resolved.set(id, value);
    return value;
  };
  const actionsById: Record<string, CharacterAction> = {};
  const add = (id: string, action: CharacterAction) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id))
      throw new Error(`Expanded choreography action ID is invalid: ${id}`);
    if (Object.hasOwn(actionsById, id))
      throw new Error(`Expanded choreography action ID collides: ${id}`);
    actionsById[id] = action;
  };
  for (const step of input.steps) {
    const timing = resolve(step.id);
    if ("ref" in step.action) {
      if (!library) throw new Error("Action reference requires a library snapshot");
      const content = expandActionReference(library, step.action.ref);
      if (content.kind === "single")
        add(
          step.id,
          CharacterAction.parse({
            ...content.action,
            actorId: step.actorId,
            startFrame: timing.start,
            durationFrames: frame(content.durationSeconds),
          }),
        );
      else
        for (const child of content.actions) {
          const expandedId = `${step.id}-${child.id}`;
          add(
            expandedId,
            CharacterAction.parse({
              ...child.action,
              actorId: step.actorId,
              startFrame: timing.start + frame(child.atSeconds),
              durationFrames: frame(child.durationSeconds),
            }),
          );
        }
    } else {
      if (step.durationSeconds === undefined)
        throw new Error(`Inline action ${step.id} requires durationSeconds`);
      add(
        step.id,
        CharacterAction.parse({
          ...step.action,
          actorId: step.actorId,
          startFrame: timing.start,
          durationFrames: frame(step.durationSeconds),
        }),
      );
    }
  }
  const actionOrder = Object.keys(actionsById).sort(
    (a, b) => actionsById[a]!.startFrame - actionsById[b]!.startFrame || a.localeCompare(b),
  );
  return { timebase, actionOrder, actionsById };
}
