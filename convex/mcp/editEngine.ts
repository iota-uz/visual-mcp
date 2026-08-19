export interface ExactEditInput {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface ExactEditResult {
  content: string;
  replacements: number;
}

export function applyExactEdit(content: string, input: ExactEditInput): ExactEditResult {
  if (input.oldString.length === 0) throw new Error("old_string must not be empty");
  if (input.oldString === input.newString)
    throw new Error("old_string and new_string are identical");
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(input.oldString, offset);
    if (index < 0) break;
    count += 1;
    offset = index + input.oldString.length;
  }
  if (count === 0) {
    throw new Error("old_string_not_found: re-read the file and provide the exact current text");
  }
  if (count > 1 && !input.replaceAll) {
    throw new Error(
      `ambiguous_match: old_string occurs ${count} times; include more context or set replace_all=true`,
    );
  }
  if (input.replaceAll) {
    return { content: content.split(input.oldString).join(input.newString), replacements: count };
  }
  const index = content.indexOf(input.oldString);
  return {
    content:
      content.slice(0, index) + input.newString + content.slice(index + input.oldString.length),
    replacements: 1,
  };
}

type PatchOperation =
  | { type: "add"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; moveTo?: string; hunks: PatchHunk[] };

interface PatchHunk {
  oldText: string;
  newText: string;
}

function validatePatchPath(path: string): string {
  const trimmed = path.trim().replace(/^\//, "");
  if (!trimmed || trimmed.split("/").includes("..") || trimmed.includes("\\")) {
    throw new Error(`Invalid patch path: ${path}`);
  }
  return `/${trimmed}`;
}

export function parseApplyPatch(raw: string): PatchOperation[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (lines.shift() !== "*** Begin Patch") throw new Error("Patch must begin with *** Begin Patch");
  if (lines.at(-1) === "") lines.pop();
  if (lines.at(-1) !== "*** End Patch") throw new Error("Patch must end with *** End Patch");
  lines.pop();
  const operations: PatchOperation[] = [];
  let index = 0;
  while (index < lines.length) {
    const header = lines[index] as string;
    if (header.startsWith("*** Add File: ")) {
      const path = validatePatchPath(header.slice("*** Add File: ".length));
      index += 1;
      const body: string[] = [];
      while (index < lines.length && !(lines[index] as string).startsWith("*** ")) {
        const line = lines[index] as string;
        if (!line.startsWith("+")) throw new Error(`Add File lines must begin with + (${path})`);
        body.push(line.slice(1));
        index += 1;
      }
      operations.push({ type: "add", path, content: `${body.join("\n")}\n` });
      continue;
    }
    if (header.startsWith("*** Delete File: ")) {
      operations.push({
        type: "delete",
        path: validatePatchPath(header.slice("*** Delete File: ".length)),
      });
      index += 1;
      continue;
    }
    if (header.startsWith("*** Update File: ")) {
      const path = validatePatchPath(header.slice("*** Update File: ".length));
      index += 1;
      let moveTo: string | undefined;
      if ((lines[index] as string | undefined)?.startsWith("*** Move to: ")) {
        moveTo = validatePatchPath((lines[index] as string).slice("*** Move to: ".length));
        index += 1;
      }
      const hunks: PatchHunk[] = [];
      while (index < lines.length && !(lines[index] as string).startsWith("*** ")) {
        const hunkHeader = lines[index] as string;
        if (!hunkHeader.startsWith("@@"))
          throw new Error(`Update File requires @@ hunks (${path})`);
        index += 1;
        const oldLines: string[] = [];
        const newLines: string[] = [];
        while (
          index < lines.length &&
          !(lines[index] as string).startsWith("@@") &&
          !(lines[index] as string).startsWith("*** ")
        ) {
          const line = lines[index] as string;
          if (line.startsWith(" ")) {
            oldLines.push(line.slice(1));
            newLines.push(line.slice(1));
          } else if (line.startsWith("-")) oldLines.push(line.slice(1));
          else if (line.startsWith("+")) newLines.push(line.slice(1));
          else if (line === "\\ No newline at end of file") {
            // Informational unified-diff marker.
          } else throw new Error(`Invalid hunk line in ${path}: ${line}`);
          index += 1;
        }
        hunks.push({ oldText: oldLines.join("\n"), newText: newLines.join("\n") });
      }
      if ((lines[index] as string | undefined) === "*** End of File") index += 1;
      if (hunks.length === 0 && !moveTo) throw new Error(`Update File has no hunks: ${path}`);
      operations.push({ type: "update", path, moveTo, hunks });
      continue;
    }
    if (header.trim() === "") {
      index += 1;
      continue;
    }
    throw new Error(`Unknown patch operation: ${header}`);
  }
  if (operations.length === 0) throw new Error("Patch has no operations");
  return operations;
}

export type PreparedPatchChange =
  | { type: "write"; path: string; expectedHash?: string; content: string }
  | { type: "delete"; path: string; expectedHash: string }
  | { type: "move"; path: string; toPath: string; expectedHash: string };

export async function prepareApplyPatch(
  patch: string,
  readFile: (path: string) => Promise<{ content: string; hash: string } | null>,
): Promise<PreparedPatchChange[]> {
  const operations = parseApplyPatch(patch);
  const changes: PreparedPatchChange[] = [];
  for (const operation of operations) {
    if (operation.type === "add") {
      if (await readFile(operation.path)) throw new Error(`File already exists: ${operation.path}`);
      changes.push({ type: "write", path: operation.path, content: operation.content });
      continue;
    }
    const current = await readFile(operation.path);
    if (!current) throw new Error(`File not found: ${operation.path}`);
    if (operation.type === "delete") {
      changes.push({ type: "delete", path: operation.path, expectedHash: current.hash });
      continue;
    }
    let content = current.content;
    for (const hunk of operation.hunks) {
      if (hunk.oldText === hunk.newText)
        throw new Error(`Patch hunk makes no change: ${operation.path}`);
      content = applyExactEdit(content, {
        oldString: hunk.oldText,
        newString: hunk.newText,
      }).content;
    }
    if (operation.moveTo) {
      if (await readFile(operation.moveTo))
        throw new Error(`Move target already exists: ${operation.moveTo}`);
      if (operation.hunks.length > 0) {
        changes.push({ type: "delete", path: operation.path, expectedHash: current.hash });
        changes.push({ type: "write", path: operation.moveTo, content });
      } else {
        changes.push({
          type: "move",
          path: operation.path,
          toPath: operation.moveTo,
          expectedHash: current.hash,
        });
      }
    } else {
      changes.push({ type: "write", path: operation.path, expectedHash: current.hash, content });
    }
  }
  return changes;
}
