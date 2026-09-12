import ts from "typescript";
import type { z } from "zod";
import {
  CharacterAction,
  type CharacterAnimationProperty,
  type CharacterAnimationTrack,
  type RigNode,
} from "./character.js";

type RigNodeValue = z.infer<typeof RigNode>;
type CharacterAnimationPropertyValue = z.infer<typeof CharacterAnimationProperty>;
type CharacterAnimationTrackValue = z.infer<typeof CharacterAnimationTrack>;

export type NumericExpression =
  | { kind: "number"; value: number }
  | { kind: "time" }
  | { kind: "context" }
  | { kind: "unary"; op: "+" | "-"; value: NumericExpression }
  | {
      kind: "binary";
      op: "+" | "-" | "*" | "/" | "%" | "**";
      left: NumericExpression;
      right: NumericExpression;
    }
  | {
      kind: "call";
      fn:
        | "abs"
        | "min"
        | "max"
        | "sin"
        | "cos"
        | "floor"
        | "ceil"
        | "round"
        | "sqrt"
        | "pow"
        | "clamp"
        | "lerp"
        | "noise";
      args: NumericExpression[];
    };

export type CompiledProceduralExpression = Readonly<{
  version: 1;
  channels: Readonly<Record<string, NumericExpression>>;
  nodeCount: number;
  depth: number;
}>;

const NODES = new Set<RigNodeValue>([
  "root",
  "body",
  "head",
  "eyes",
  "mouth",
  "leftShoulder",
  "leftElbow",
  "leftHand",
  "rightShoulder",
  "rightElbow",
  "rightHand",
]);
const PROPERTIES = new Set<CharacterAnimationPropertyValue>([
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "opacity",
]);
const FUNCTIONS = new Set([
  "abs",
  "min",
  "max",
  "sin",
  "cos",
  "floor",
  "ceil",
  "round",
  "sqrt",
  "pow",
  "clamp",
  "lerp",
  "noise",
] as const);
const MAX_SOURCE = 8_000,
  MAX_NODES = 256,
  MAX_DEPTH = 16,
  MAX_CHANNELS = 32;

export function compileProceduralExpression(source: string): CompiledProceduralExpression {
  if (source.length > MAX_SOURCE)
    throw new Error(`Procedural source exceeds ${MAX_SOURCE} characters`);
  const file = ts.createSourceFile(
    "procedure.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] })
    .parseDiagnostics;
  if (diagnostics.length)
    throw new Error(`Invalid procedural syntax: ${diagnostics[0]!.messageText}`);
  if (file.statements.length !== 1 || !ts.isExpressionStatement(file.statements[0]!))
    throw new Error("Procedure must contain exactly one arrow expression");
  let root: ts.Expression = file.statements[0].expression;
  while (ts.isParenthesizedExpression(root)) root = root.expression;
  if (
    !ts.isArrowFunction(root) ||
    root.modifiers?.length ||
    root.typeParameters ||
    root.type ||
    root.equalsGreaterThanToken === undefined
  )
    throw new Error("Procedure must be an untyped arrow function");
  if (
    root.parameters.length !== 2 ||
    root.parameters[0]?.name.getText(file) !== "t" ||
    root.parameters[1]?.name.getText(file) !== "ctx" ||
    root.parameters.some((p) => p.dotDotDotToken || p.initializer || p.type)
  )
    throw new Error("Procedure signature must be exactly (t,ctx)");
  let body: ts.Expression = root.body as ts.Expression;
  while (ts.isParenthesizedExpression(body)) body = body.expression;
  if (!ts.isObjectLiteralExpression(body))
    throw new Error("Procedure body must return an object literal directly");
  let nodes = 0,
    maxDepth = 0;
  const visit = (node: ts.Expression, depth: number): NumericExpression => {
    nodes++;
    maxDepth = Math.max(maxDepth, depth);
    if (nodes > MAX_NODES) throw new Error(`Procedural expression exceeds ${MAX_NODES} AST nodes`);
    if (depth > MAX_DEPTH) throw new Error(`Procedural expression exceeds depth ${MAX_DEPTH}`);
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    if (ts.isNumericLiteral(node)) return { kind: "number", value: Number(node.text) };
    if (ts.isIdentifier(node)) {
      if (node.text === "t") return { kind: "time" };
      if (node.text === "ctx") return { kind: "context" };
      throw new Error(`Identifier is not allowed: ${node.text}`);
    }
    if (
      ts.isPrefixUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.PlusToken || node.operator === ts.SyntaxKind.MinusToken)
    )
      return {
        kind: "unary",
        op: node.operator === ts.SyntaxKind.PlusToken ? "+" : "-",
        value: visit(node.operand, depth + 1),
      };
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.getText(file);
      if (!["+", "-", "*", "/", "%", "**"].includes(op))
        throw new Error(`Operator is not allowed: ${op}`);
      return {
        kind: "binary",
        op: op as "+" | "-" | "*" | "/" | "%" | "**",
        left: visit(node.left, depth + 1),
        right: visit(node.right, depth + 1),
      };
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      FUNCTIONS.has(node.expression.text as never)
    ) {
      if (node.typeArguments?.length || node.questionDotToken)
        throw new Error("Generic or optional calls are not allowed");
      return {
        kind: "call",
        fn: node.expression.text as NumericExpression & never,
        args: node.arguments.map((arg) => visit(arg, depth + 1)),
      } as NumericExpression;
    }
    throw new Error(`Syntax is not allowed: ${ts.SyntaxKind[node.kind]}`);
  };
  if (body.properties.length === 0 || body.properties.length > MAX_CHANNELS)
    throw new Error(`Procedure must define 1-${MAX_CHANNELS} channels`);
  const channels: Record<string, NumericExpression> = {};
  for (const property of body.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      (!ts.isStringLiteral(property.name) && !ts.isIdentifier(property.name))
    )
      throw new Error("Only static channel property assignments are allowed");
    const key = property.name.text,
      [node, channel, extra] = key.split(".");
    if (
      extra ||
      !NODES.has(node as RigNodeValue) ||
      !PROPERTIES.has(channel as CharacterAnimationPropertyValue)
    )
      throw new Error(`Unknown numeric channel: ${key}`);
    if (Object.hasOwn(channels, key)) throw new Error(`Duplicate numeric channel: ${key}`);
    channels[key] = visit(property.initializer, 1);
  }
  return Object.freeze({
    version: 1,
    channels: Object.freeze(channels),
    nodeCount: nodes,
    depth: maxDepth,
  });
}

function noise(x: number, seed: number) {
  const v = Math.sin(x * 12.9898 + seed * 78.233) * 43758.5453123;
  return (v - Math.floor(v)) * 2 - 1;
}
function evaluate(
  expression: NumericExpression,
  t: number,
  seed: number,
  budget: { left: number },
): number {
  if (--budget.left < 0) throw new Error("Procedural evaluation budget exceeded");
  if (expression.kind === "number") return expression.value;
  if (expression.kind === "time") return t;
  if (expression.kind === "context") return seed;
  if (expression.kind === "unary") {
    const v = evaluate(expression.value, t, seed, budget);
    return expression.op === "-" ? -v : v;
  }
  if (expression.kind === "binary") {
    const a = evaluate(expression.left, t, seed, budget),
      b = evaluate(expression.right, t, seed, budget);
    return expression.op === "+"
      ? a + b
      : expression.op === "-"
        ? a - b
        : expression.op === "*"
          ? a * b
          : expression.op === "/"
            ? a / b
            : expression.op === "%"
              ? a % b
              : a ** b;
  }
  const a = expression.args.map((arg) => evaluate(arg, t, seed, budget));
  const functions: Record<string, (...values: number[]) => number> = {
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    sin: Math.sin,
    cos: Math.cos,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    sqrt: Math.sqrt,
    pow: Math.pow,
    clamp: (v, lo, hi) => Math.min(hi!, Math.max(lo!, v!)),
    lerp: (from, to, amount) => from! + (to! - from!) * amount!,
    noise: (x, context = seed) => noise(x!, context!),
  };
  const arities: Record<string, [number, number]> = {
    abs: [1, 1],
    min: [1, 8],
    max: [1, 8],
    sin: [1, 1],
    cos: [1, 1],
    floor: [1, 1],
    ceil: [1, 1],
    round: [1, 1],
    sqrt: [1, 1],
    pow: [2, 2],
    clamp: [3, 3],
    lerp: [3, 3],
    noise: [1, 2],
  };
  const [lo, hi] = arities[expression.fn]!;
  if (a.length < lo || a.length > hi)
    throw new Error(`${expression.fn} expects ${lo}-${hi} arguments`);
  return functions[expression.fn]!(...a);
}

export function bakeProceduralAction(input: {
  source: string;
  actorId: string;
  startFrame: number;
  durationFrames: number;
  timebase: { numerator: number; denominator: number };
  seed: number;
  mode?: "override" | "additive";
  priority?: number;
}): CharacterAction {
  const compiled = compileProceduralExpression(input.source);
  if (
    !Number.isInteger(input.durationFrames) ||
    input.durationFrames < 1 ||
    input.durationFrames > 7200
  )
    throw new Error("Procedural durationFrames must be between 1 and 7200");
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff)
    throw new Error("Procedural seed must be a uint32");
  const count = Math.min(64, input.durationFrames),
    frames = Array.from({ length: count }, (_, i) =>
      count === 1 ? 0 : Math.round((i * (input.durationFrames - 1)) / (count - 1)),
    );
  const tracks: CharacterAnimationTrackValue[] = Object.entries(compiled.channels).map(
    ([key, expression]) => {
      const [node, property] = key.split(".") as [RigNodeValue, CharacterAnimationPropertyValue];
      return {
        node,
        property,
        mode: input.mode ?? "override",
        keyframes: frames.map((frame) => {
          const value = evaluate(
            expression,
            (frame * input.timebase.denominator) / input.timebase.numerator,
            input.seed,
            { left: 1024 },
          );
          if (!Number.isFinite(value) || Math.abs(value) > 1_000_000)
            throw new Error(`Channel ${key} produced an invalid value at frame ${frame}`);
          return { frame, value, easing: "linear" as const };
        }),
      };
    },
  );
  return CharacterAction.parse({
    type: "animate",
    actorId: input.actorId,
    startFrame: input.startFrame,
    durationFrames: input.durationFrames,
    priority: input.priority ?? 0,
    tracks,
  });
}
