import assert from "node:assert/strict";
import { test } from "node:test";
import { builtInCharacterPacks } from "../src/character-packs.js";
import { stageCharacterActors } from "../src/character-staging.js";

const actors = () => ({
  customer: {
    characterPackId: "customer",
    x: 0.1,
    y: 0.2,
    scale: 0.2,
    facing: "right" as const,
    initialEmotion: "neutral" as const,
  },
  mascot: {
    characterPackId: "farq-mascot",
    x: 0.9,
    y: 0.2,
    scale: 2,
    facing: "left" as const,
    initialEmotion: "happy" as const,
  },
});

test("two-shot layout balances pack bounds without overlap and preserves actor identity", () => {
  const original = actors();
  const staged = stageCharacterActors({
    layout: "two-shot",
    actorOrder: ["customer", "mascot"],
    actorsById: original,
    characterPacksById: builtInCharacterPacks,
  });
  assert.equal(staged.customer!.characterPackId, "customer");
  assert.equal(staged.mascot!.facing, "left");
  assert.equal(original.customer.scale, 0.2, "authoring helper must not mutate input");
  const customerHeight =
    staged.customer!.scale * builtInCharacterPacks.customer!.viewBox.height;
  const mascotHeight =
    staged.mascot!.scale * builtInCharacterPacks["farq-mascot"]!.viewBox.height;
  assert.ok(Math.max(customerHeight, mascotHeight) / Math.min(customerHeight, mascotHeight) < 1.3);
  assert.ok(staged.customer!.x < staged.mascot!.x);
  const customerRight = staged.customer!.x +
    (staged.customer!.scale * builtInCharacterPacks.customer!.viewBox.width) / 2160;
  const mascotLeft = staged.mascot!.x -
    (staged.mascot!.scale * builtInCharacterPacks["farq-mascot"]!.viewBox.width) / 2160;
  assert.ok(customerRight < mascotLeft, "two-shot bounds must not overlap");
});

test("single-product reserves the central product and upper graphic corridor", () => {
  const staged = stageCharacterActors({
    layout: "single-product",
    actorOrder: ["customer", "mascot"],
    actorsById: actors(),
    characterPacksById: builtInCharacterPacks,
  });
  for (const actor of Object.values(staged)) {
    const pack = builtInCharacterPacks[actor.characterPackId]!;
    const halfWidth = (actor.scale * pack.viewBox.width) / 2160;
    const halfHeight = (actor.scale * pack.viewBox.height) / 3840;
    assert.ok(actor.y - halfHeight >= 0.58);
    assert.ok(actor.y + halfHeight <= 1);
    assert.ok(actor.x - halfWidth >= 0 && actor.x + halfWidth <= 1);
    assert.ok(actor.x + halfWidth <= 0.28 || actor.x - halfWidth >= 0.72);
  }
});

test("layouts reject crowd counts they cannot compose without unsafe overlap", () => {
  const crowded = Object.fromEntries(
    Array.from({ length: 4 }, (_, index) => [`actor${index}`, actors().customer]),
  );
  assert.throws(() =>
    stageCharacterActors({
      layout: "single-product",
      actorOrder: Object.keys(crowded),
      actorsById: crowded,
      characterPacksById: builtInCharacterPacks,
    }),
  );
  assert.throws(() =>
    stageCharacterActors({
      layout: "reaction-closeup",
      actorOrder: Object.keys(crowded),
      actorsById: crowded,
      characterPacksById: builtInCharacterPacks,
    }),
  );
});

test("reaction closeup makes the selected focal actor dominant across pack sizes", () => {
  const staged = stageCharacterActors({
    layout: "reaction-closeup",
    focalActorId: "mascot",
    actorOrder: ["customer", "mascot"],
    actorsById: actors(),
    characterPacksById: builtInCharacterPacks,
  });
  const focalHeight =
    staged.mascot!.scale * builtInCharacterPacks["farq-mascot"]!.viewBox.height;
  const supportingHeight =
    staged.customer!.scale * builtInCharacterPacks.customer!.viewBox.height;
  assert.ok(focalHeight > supportingHeight * 1.5);
  assert.equal(staged.mascot!.x, 0.5);
});
