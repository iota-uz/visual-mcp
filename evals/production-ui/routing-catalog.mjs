const VARIANTS = new Set(["current", "base-only", "compact-routing"]);

export function applyDescriptionVariant(description = "", variant = "current") {
  if (!VARIANTS.has(variant)) throw new Error(`Unknown description variant: ${variant}`);
  if (variant === "current") return description;
  if (variant === "base-only") {
    const match = description.match(/^Use: ([\s\S]*?)\. Do not use:/);
    return match?.[1] ?? description;
  }
  const match = description.match(/^([\s\S]*?Prefer: [\s\S]*?) Side effects:/);
  return match?.[1] ?? description;
}

export function transformToolMetadata(toolMetadata, variant = "current") {
  return toolMetadata.map((tool) => ({
    ...tool,
    description: applyDescriptionVariant(tool.description, variant),
  }));
}

export function catalogMetrics(toolMetadata) {
  const serialized = JSON.stringify(toolMetadata);
  return {
    tools: toolMetadata.length,
    characters: serialized.length,
    estimated_tokens: Math.ceil(serialized.length / 4),
  };
}

export function longContextFiller(characters) {
  if (!Number.isInteger(characters) || characters < 0) {
    throw new Error("context characters must be a non-negative integer");
  }
  const paragraph =
    "Archived project note: this material is unrelated to Visual Canvas routing and exists only to simulate a long-lived agent context. ";
  return paragraph.repeat(Math.ceil(characters / paragraph.length)).slice(0, characters);
}
