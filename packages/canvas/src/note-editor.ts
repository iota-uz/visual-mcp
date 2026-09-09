import { CONTEXT_MENU_CHROME_SELECTOR } from "./context-menu.js";
import { escapeHtml, renderNote } from "./render.js";
import {
  type CanvasNote,
  NOTE_COLORS,
  NOTE_MAX_TEXT,
  NOTE_MAX_WIDTH,
  NOTE_MIN_WIDTH,
  NOTE_SIZES,
  type NoteColor,
  type NoteSize,
  type Point,
} from "./types.js";

export const NOTE_DEFAULT_WIDTH = 220;

export type NoteChanges = Partial<Pick<CanvasNote, "x" | "y" | "w" | "text" | "color" | "size">>;

export interface NoteEditorOptions {
  container: HTMLElement;
  /** The live `.vc-notes` layer — re-queried on every call because reconciliation replaces it. */
  notesRoot: () => HTMLElement | null;
  /** The live document's notes; mutated in place the way node rects are. */
  notes: () => CanvasNote[];
  editable: boolean;
  toWorld: (clientX: number, clientY: number) => Point;
  toScreen: (world: Point) => { x: number; y: number };
  scale: () => number;
  dragThreshold: () => number;
  onAdd?: (note: CanvasNote) => void | Promise<void>;
  onChange?: (id: string, changes: NoteChanges, previous: CanvasNote) => void | Promise<void>;
  onDelete?: (id: string, note: CanvasNote) => void | Promise<void>;
  /** Fires on every selection change, including clears. */
  onSelect?: (id: string | null) => void;
}

export interface NoteEditorController {
  select(id: string | null): void;
  selectedId(): string | null;
  isEditing(): boolean;
  beginEdit(id: string): void;
  /** Drops a provisional note at a world point and opens it for typing. */
  createAt(point: Point): void;
  commit(): void;
  cancel(): void;
  deleteSelected(): void;
  /** Arrow-key move of the selected note; false when there is none. */
  nudge(dx: number, dy: number): boolean;
  /** After the notes layer was re-rendered: put selection, editor and handles back. */
  refresh(): void;
  positionStrip(): void;
  stripElement(): HTMLElement;
  destroy(): void;
}

const STRIP_SHELL = `<div class="vc-note-strip" hidden role="toolbar" aria-label="Sticky note">
    <div class="vc-note-strip-colors" role="group" aria-label="Colour">${NOTE_COLORS.map(
      (color) =>
        `<button type="button" class="vc-note-swatch" data-note-color="${color}" aria-label="${color}" title="${color[0]?.toUpperCase()}${color.slice(1)}"></button>`,
    ).join("")}</div>
    <div class="vc-note-strip-sizes" role="group" aria-label="Text size">${NOTE_SIZES.map(
      (size) =>
        `<button type="button" class="vc-note-size" data-note-size="${size}" aria-label="Size ${size.toUpperCase()}">${size.toUpperCase()}</button>`,
    ).join("")}</div>
    <button type="button" class="vc-note-delete" data-note-delete aria-label="Delete note" title="Delete note (⌫)">Delete</button>
  </div>`;

function noteId(): string {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Sticky notes: select, drag, resize, retype, recolour. Modelled on the
 * edge editor — capture-phase listeners on the viewport container so the
 * viewport's own pointer handling never sees a press on a note, and a
 * screen-space strip that rides the camera above the selected note.
 *
 * A note being typed into is "provisional" until its first non-empty
 * commit: it exists only in the DOM, and closing it empty simply removes
 * it. That is what makes "press N, click, change your mind" free.
 */
export function mountNoteEditor(options: NoteEditorOptions): NoteEditorController {
  const { container } = options;
  const strip = document.createElement("div");
  strip.innerHTML = STRIP_SHELL;
  const stripEl = strip.firstElementChild as HTMLElement;
  container.append(stripEl);

  let selected: string | null = null;
  let editing: { id: string; textarea: HTMLTextAreaElement; provisional: boolean } | null = null;
  let provisional: { note: CanvasNote; element: HTMLElement } | null = null;
  let drag: {
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origin: { x: number; y: number; w: number };
    moved: boolean;
    pointerId: number;
  } | null = null;
  let cancelling = false;
  // Same window the viewport uses for node-title rename: pointerdown's
  // preventDefault + capture suppress the browser's `dblclick`, so the
  // second press has to be recognized here.
  let lastClick: { id: string; at: number } | null = null;

  const noteById = (id: string): CanvasNote | undefined =>
    provisional?.note.id === id ? provisional.note : options.notes().find((n) => n.id === id);
  const elementFor = (id: string): HTMLElement | null =>
    provisional?.note.id === id
      ? provisional.element
      : (options
          .notesRoot()
          ?.querySelector<HTMLElement>(`.vc-note[data-note-id="${CSS.escape(id)}"]`) ?? null);

  function paintSelected(): void {
    const root = options.notesRoot();
    for (const el of root?.querySelectorAll<HTMLElement>(".vc-note") ?? []) {
      const isSelected = el.dataset.noteId === selected;
      el.classList.toggle("selected", isSelected);
      const handle = el.querySelector(".vc-note-resize");
      if (isSelected && options.editable && !handle) {
        const grip = document.createElement("i");
        grip.className = "vc-note-resize";
        grip.setAttribute("aria-hidden", "true");
        el.append(grip);
      } else if (!isSelected && handle) handle.remove();
    }
    if (provisional)
      provisional.element.classList.toggle("selected", provisional.note.id === selected);
    paintStrip();
  }

  function paintStrip(): void {
    const note = selected ? noteById(selected) : undefined;
    const show = Boolean(note) && options.editable;
    stripEl.toggleAttribute("hidden", !show);
    if (!note) return;
    for (const button of stripEl.querySelectorAll<HTMLButtonElement>("[data-note-color]"))
      button.setAttribute("aria-pressed", String(button.dataset.noteColor === note.color));
    for (const button of stripEl.querySelectorAll<HTMLButtonElement>("[data-note-size]"))
      button.setAttribute("aria-pressed", String(button.dataset.noteSize === note.size));
    positionStrip();
  }

  function positionStrip(): void {
    if (stripEl.hasAttribute("hidden") || !selected) return;
    const note = noteById(selected);
    const el = elementFor(selected);
    if (!note || !el) return;
    const at = options.toScreen({ x: note.x, y: note.y });
    const width = note.w * options.scale();
    const stripWidth = stripEl.offsetWidth || 240;
    const stripHeight = stripEl.offsetHeight || 36;
    const box = container.getBoundingClientRect();
    let x = at.x + width / 2 - stripWidth / 2;
    x = Math.min(Math.max(8, x), Math.max(8, box.width - stripWidth - 8));
    let y = at.y - stripHeight - 10;
    if (y < 8) y = at.y + el.offsetHeight * options.scale() + 10;
    stripEl.style.transform = `translate(${x}px, ${y}px)`;
  }

  function select(id: string | null): void {
    if (id === selected) return;
    if (editing && editing.id !== id) commit();
    if (id && !noteById(id)) return;
    selected = id;
    paintSelected();
    options.onSelect?.(id);
  }

  function autosize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  function beginEdit(id: string, isProvisional = false): void {
    if (!options.editable) return;
    if (editing?.id === id) return;
    if (editing) commit();
    const note = noteById(id);
    const el = elementFor(id);
    if (!note || !el) return;
    if (selected !== id) select(id);
    const text = el.querySelector<HTMLElement>(".vc-note-text");
    if (!text) return;
    const textarea = document.createElement("textarea");
    textarea.className = "vc-note-editor";
    textarea.rows = 1;
    textarea.maxLength = NOTE_MAX_TEXT;
    textarea.setAttribute("aria-label", "Note text");
    textarea.value = note.text;
    text.replaceChildren(textarea);
    el.classList.add("is-editing");
    editing = { id, textarea, provisional: isProvisional };
    textarea.addEventListener("input", onEditorInput);
    textarea.addEventListener("keydown", onEditorKeyDown);
    textarea.addEventListener("blur", onEditorBlur);
    autosize(textarea);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function onEditorInput(): void {
    if (editing) autosize(editing.textarea);
    positionStrip();
  }

  function onEditorKeyDown(event: KeyboardEvent): void {
    // The textarea owns the keyboard: no tool letters, no Delete-the-note.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  }

  function onEditorBlur(): void {
    if (!cancelling) commit();
  }

  function teardownEditor(): { id: string; value: string; provisional: boolean } | null {
    if (!editing) return null;
    const { id, textarea, provisional: wasProvisional } = editing;
    editing = null;
    textarea.removeEventListener("input", onEditorInput);
    textarea.removeEventListener("keydown", onEditorKeyDown);
    textarea.removeEventListener("blur", onEditorBlur);
    const value = textarea.value;
    const el = elementFor(id);
    el?.classList.remove("is-editing");
    return { id, value, provisional: wasProvisional };
  }

  function paintText(id: string, text: string): void {
    const el = elementFor(id);
    const holder = el?.querySelector<HTMLElement>(".vc-note-text");
    if (holder) holder.textContent = text;
  }

  function commit(): void {
    const done = teardownEditor();
    if (!done) return;
    const value = done.value.replace(/\r\n/g, "\n");
    const trimmed = value.trim();
    if (done.provisional && provisional) {
      const draft = provisional;
      if (!trimmed) {
        discardProvisional();
        return;
      }
      const note: CanvasNote = { ...draft.note, text: value };
      provisional = null;
      // The element stays where it is; the reactive update that follows
      // the write replaces it with the rendered one.
      draft.element.classList.remove("is-provisional");
      options.notes().push(note);
      paintText(note.id, value);
      void options.onAdd?.(note);
      paintSelected();
      container.focus({ preventScroll: true });
      return;
    }
    const note = noteById(done.id);
    if (!note) return;
    if (!trimmed || value === note.text) {
      paintText(done.id, note.text);
      container.focus({ preventScroll: true });
      return;
    }
    const previous = { ...note };
    note.text = value;
    paintText(done.id, value);
    void options.onChange?.(done.id, { text: value }, previous);
    positionStrip();
    container.focus({ preventScroll: true });
  }

  function cancel(): void {
    cancelling = true;
    try {
      const done = teardownEditor();
      if (!done) return;
      if (done.provisional) {
        discardProvisional();
        return;
      }
      const note = noteById(done.id);
      if (note) paintText(done.id, note.text);
    } finally {
      cancelling = false;
      container.focus({ preventScroll: true });
    }
  }

  function discardProvisional(): void {
    const draft = provisional;
    provisional = null;
    draft?.element.remove();
    if (selected === draft?.note.id) {
      selected = null;
      paintSelected();
      options.onSelect?.(null);
    }
  }

  function createAt(point: Point): void {
    if (!options.editable) return;
    const root = options.notesRoot();
    if (!root) return;
    if (editing) commit();
    if (provisional) discardProvisional();
    const note: CanvasNote = {
      id: noteId(),
      x: Math.round(point.x),
      y: Math.round(point.y),
      w: NOTE_DEFAULT_WIDTH,
      text: "",
      color: "yellow",
      size: "m",
      author: "human",
    };
    const scratch = document.createElement("div");
    scratch.innerHTML = renderNote(note);
    const element = scratch.firstElementChild as HTMLElement;
    element.classList.add("is-provisional");
    root.append(element);
    provisional = { note, element };
    selected = note.id;
    paintSelected();
    options.onSelect?.(note.id);
    beginEdit(note.id, true);
  }

  function deleteSelected(): void {
    if (!selected || !options.editable) return;
    if (provisional?.note.id === selected) {
      cancel();
      return;
    }
    const id = selected;
    const note = noteById(id);
    if (!note) return;
    if (editing) cancel();
    const notes = options.notes();
    const index = notes.findIndex((n) => n.id === id);
    if (index >= 0) notes.splice(index, 1);
    elementFor(id)?.remove();
    selected = null;
    paintSelected();
    options.onSelect?.(null);
    void options.onDelete?.(id, note);
  }

  function applyChanges(id: string, changes: NoteChanges): void {
    const note = noteById(id);
    if (!note) return;
    const previous = { ...note };
    Object.assign(note, changes);
    const el = elementFor(id);
    if (el) {
      el.style.left = `${note.x}px`;
      el.style.top = `${note.y}px`;
      el.style.width = `${note.w}px`;
      el.dataset.color = note.color;
      el.dataset.size = note.size;
    }
    if (editing?.id === id) autosize(editing.textarea);
    paintStrip();
    if (provisional?.note.id === id) return;
    void options.onChange?.(id, changes, previous);
  }

  function nudge(dx: number, dy: number): boolean {
    if (!selected || !options.editable || editing) return false;
    const note = noteById(selected);
    if (!note) return false;
    applyChanges(selected, { x: note.x + dx, y: note.y + dy });
    return true;
  }

  function onStripClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!selected) return;
    const color = target.closest<HTMLElement>("[data-note-color]")?.dataset.noteColor;
    if (color && (NOTE_COLORS as readonly string[]).includes(color)) {
      applyChanges(selected, { color: color as NoteColor });
      return;
    }
    const size = target.closest<HTMLElement>("[data-note-size]")?.dataset.noteSize;
    if (size && (NOTE_SIZES as readonly string[]).includes(size)) {
      applyChanges(selected, { size: size as NoteSize });
      return;
    }
    if (target.closest("[data-note-delete]")) deleteSelected();
  }

  function onPointerDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest(".vc-note-strip, .vc-note-editor")) return;
    const noteEl = target.closest<HTMLElement>(".vc-note");
    if (!noteEl) {
      // A press anywhere else means "done with this note" — except on the
      // chrome that acts on it, which must keep the selection it needs.
      if (selected && !target.closest(CONTEXT_MENU_CHROME_SELECTOR)) select(null);
      lastClick = null;
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const id = noteEl.dataset.noteId;
    if (!id) return;
    event.stopPropagation();
    event.preventDefault();
    if (editing && editing.id !== id) commit();
    select(id);
    if (!options.editable) return;
    const note = noteById(id);
    if (!note) return;
    const now = Date.now();
    const doubleTap =
      lastClick !== null &&
      lastClick.id === id &&
      now - lastClick.at < 500 &&
      !target.closest(".vc-note-resize");
    if (doubleTap) {
      lastClick = null;
      beginEdit(id);
      return;
    }
    if (editing?.id === id) return;
    try {
      container.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and synthetic events have no pointer to capture; the drag
      // still works while the pointer stays over the container.
    }
    drag = {
      id,
      mode: target.closest(".vc-note-resize") ? "resize" : "move",
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: note.x, y: note.y, w: note.w },
      moved: false,
      pointerId: event.pointerId,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= options.dragThreshold()) return;
    drag.moved = true;
    container.classList.add("is-moving-note");
    const scale = options.scale();
    const note = noteById(drag.id);
    const el = elementFor(drag.id);
    if (!note || !el) return;
    if (drag.mode === "move") {
      note.x = Math.round(drag.origin.x + dx / scale);
      note.y = Math.round(drag.origin.y + dy / scale);
      el.style.left = `${note.x}px`;
      el.style.top = `${note.y}px`;
    } else {
      note.w = Math.round(
        Math.min(NOTE_MAX_WIDTH, Math.max(NOTE_MIN_WIDTH, drag.origin.w + dx / scale)),
      );
      el.style.width = `${note.w}px`;
    }
    positionStrip();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const finished = drag;
    drag = null;
    container.classList.remove("is-moving-note");
    if (!finished.moved) {
      lastClick = { id: finished.id, at: Date.now() };
      return;
    }
    lastClick = null;
    const note = noteById(finished.id);
    if (!note) return;
    const previous: CanvasNote = { ...note, ...finished.origin };
    const changes: NoteChanges =
      finished.mode === "move" ? { x: note.x, y: note.y } : { w: note.w };
    if (provisional?.note.id === finished.id) return;
    void options.onChange?.(finished.id, changes, previous);
  }

  function onPointerCancel(): void {
    lastClick = null;
    if (!drag) return;
    const note = noteById(drag.id);
    if (note) {
      Object.assign(note, drag.origin);
      const el = elementFor(drag.id);
      if (el) {
        el.style.left = `${note.x}px`;
        el.style.top = `${note.y}px`;
        el.style.width = `${note.w}px`;
      }
    }
    drag = null;
    container.classList.remove("is-moving-note");
    positionStrip();
  }

  function onDoubleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest(".vc-note-editor")) return;
    const id = target.closest<HTMLElement>(".vc-note")?.dataset.noteId;
    if (!id) return;
    event.stopPropagation();
    event.preventDefault();
    beginEdit(id);
  }

  function refresh(): void {
    const root = options.notesRoot();
    if (provisional && root && !provisional.element.isConnected) root.append(provisional.element);
    if (selected && !noteById(selected)) {
      if (editing) teardownEditor();
      selected = null;
      options.onSelect?.(null);
    }
    if (editing) {
      // The layer was re-rendered under the textarea: remount it on the new
      // element with the draft carried over.
      const { id, textarea, provisional: wasProvisional } = editing;
      if (!textarea.isConnected) {
        const draft = textarea.value;
        const caret = textarea.selectionStart;
        teardownEditor();
        beginEdit(id, wasProvisional);
        if (editing) {
          const next = (editing as { textarea: HTMLTextAreaElement }).textarea;
          next.value = draft;
          autosize(next);
          next.setSelectionRange(caret, caret);
        }
      }
    }
    paintSelected();
  }

  stripEl.addEventListener("click", onStripClick);
  container.addEventListener("pointerdown", onPointerDown, true);
  container.addEventListener("pointermove", onPointerMove, true);
  container.addEventListener("pointerup", onPointerUp, true);
  container.addEventListener("pointercancel", onPointerCancel, true);
  container.addEventListener("dblclick", onDoubleClick, true);

  return {
    select,
    selectedId: () => selected,
    isEditing: () => editing !== null,
    beginEdit: (id) => beginEdit(id, provisional?.note.id === id),
    createAt,
    commit,
    cancel,
    deleteSelected,
    nudge,
    refresh,
    positionStrip,
    stripElement: () => stripEl,
    destroy() {
      if (editing) cancel();
      if (provisional) discardProvisional();
      stripEl.removeEventListener("click", onStripClick);
      container.removeEventListener("pointerdown", onPointerDown, true);
      container.removeEventListener("pointermove", onPointerMove, true);
      container.removeEventListener("pointerup", onPointerUp, true);
      container.removeEventListener("pointercancel", onPointerCancel, true);
      container.removeEventListener("dblclick", onDoubleClick, true);
      stripEl.remove();
    },
  };
}

/** Accessible name for a note, for the inspector and menus. */
export function noteLabel(note: Pick<CanvasNote, "text" | "author">): string {
  const line = note.text.trim().split(/\r?\n/, 1)[0] ?? "";
  return `${note.author === "human" ? "Your note" : "Agent note"}: ${escapeHtml(line)}`;
}
