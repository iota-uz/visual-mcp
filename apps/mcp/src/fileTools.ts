export interface FileReadRequest {
  startLine?: number;
  endLine?: number;
  startByte?: number;
  endByte?: number;
}

export interface FileProjection {
  encoding: "utf-8" | "base64";
  content: string;
  responseBytes: number;
  range: {
    kind: "full" | "lines" | "bytes";
    start: number;
    end: number;
    total: number;
  };
  truncated: boolean;
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)),
    );
  }
  return btoa(binary);
}

export function projectTextFile(
  content: string,
  request: FileReadRequest,
  maxResponseBytes: number,
): FileProjection {
  const bytes = new TextEncoder().encode(content);
  let projected = content;
  let kind: "full" | "lines" | "bytes" = "full";
  let start = 0;
  let end = bytes.byteLength;
  let total = bytes.byteLength;
  let truncated = false;
  let encoding: "utf-8" | "base64" = "utf-8";

  if (request.startLine !== undefined) {
    kind = "lines";
    const lines = content.split("\n");
    start = request.startLine;
    end = Math.min(request.endLine ?? request.startLine + 199, lines.length);
    total = lines.length;
    projected = lines.slice(start - 1, end).join("\n");
    truncated = end < lines.length;
  } else if (request.startByte !== undefined) {
    kind = "bytes";
    start = Math.min(request.startByte, bytes.byteLength);
    const maxRawBytes = Math.floor(maxResponseBytes / 4) * 3;
    end = Math.min(request.endByte ?? start + maxRawBytes, bytes.byteLength);
    total = bytes.byteLength;
    if (end - start > maxRawBytes) {
      throw new Error(
        `range_too_large: base64 byte ranges are capped at ${maxRawBytes} raw bytes; request a smaller range.`,
      );
    }
    encoding = "base64";
    projected = base64Bytes(bytes.slice(start, end));
    truncated = end < bytes.byteLength;
  } else if (bytes.byteLength > maxResponseBytes) {
    throw new Error(
      `file_too_large: file is ${bytes.byteLength} bytes. Request a line or byte range; one file response is capped at ${maxResponseBytes} bytes.`,
    );
  }

  const responseBytes = new TextEncoder().encode(projected).byteLength;
  if (responseBytes > maxResponseBytes) {
    throw new Error(
      `range_too_large: requested content exceeds ${maxResponseBytes} bytes; request a smaller range.`,
    );
  }
  return {
    encoding,
    content: projected,
    responseBytes,
    range: { kind, start, end, total },
    truncated,
  };
}

export interface TextSearchMatch {
  line: number;
  column: number;
  preview: string;
}

export function searchText(
  content: string,
  query: string,
  options: { caseSensitive: boolean; contextLines: number; maxMatches: number },
): TextSearchMatch[] {
  const lines = content.split("\n");
  const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
  const matches: TextSearchMatch[] = [];
  for (let index = 0; index < lines.length && matches.length < options.maxMatches; index += 1) {
    const haystack = options.caseSensitive ? lines[index] : lines[index]?.toLocaleLowerCase();
    const column = haystack?.indexOf(needle) ?? -1;
    if (column < 0) continue;
    const from = Math.max(0, index - options.contextLines);
    const to = Math.min(lines.length, index + options.contextLines + 1);
    matches.push({
      line: index + 1,
      column: column + 1,
      preview: lines.slice(from, to).join("\n"),
    });
  }
  return matches;
}
