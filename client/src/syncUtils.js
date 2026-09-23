// ── Switch Sequencer ────────────────────────────────────────────
// Prevents stale FILE_SYNC_RESPONSE from overwriting current file
export class SwitchSequencer {
    constructor() {
        this.currentSeq = 0;
    }
    next() { return ++this.currentSeq; }
    isValid(seq) { return seq === this.currentSeq; }
}

// ── Cursor Transform (3-zone: before / inside-deleted / after) ──
export const transformCursor = (cursorPos, change) => {
    if (!cursorPos || !change) return cursorPos;
    const { line, ch } = cursorPos;
    const { from, to, text } = change;
    if (!from || !to || !text) return cursorPos;

    // Zone 1: Cursor is BEFORE the change — no transform needed
    if (line < from.line || (line === from.line && ch <= from.ch)) {
        return cursorPos;
    }

    // Zone 2: Cursor is INSIDE the deleted region — snap to insert end
    const isInsideDeleted =
        (line > from.line && line < to.line) ||
        (line === from.line && line === to.line && ch >= from.ch && ch <= to.ch) ||
        (line === from.line && line < to.line && ch >= from.ch) ||
        (line === to.line && line > from.line && ch <= to.ch);

    if (isInsideDeleted) {
        const lastInsertedLine = text[text.length - 1];
        if (text.length === 1) {
            return { line: from.line, ch: from.ch + lastInsertedLine.length };
        }
        return { line: from.line + text.length - 1, ch: lastInsertedLine.length };
    }

    // Zone 3: Cursor is AFTER the change — shift by delta
    const linesRemoved = to.line - from.line;
    const linesAdded = text.length - 1;
    const lineDelta = linesAdded - linesRemoved;

    if (line === to.line) {
        const lastInsertedLine = text[text.length - 1];
        const newCh = ch - to.ch + lastInsertedLine.length;
        return { line: line + lineDelta, ch: newCh };
    }

    return { line: line + lineDelta, ch };
};

// ── Op ID Generator ────────────────────────────────────────────
let _opCounter = 0;
export const generateOpId = () => {
    _opCounter += 1;
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${_opCounter}`;
};

// ── Flushable Debounce ─────────────────────────────────────────
// Returns { call, flush, cancel } — stores in useRef for stability
export const createFlushableDebounce = (fn, delay) => {
    let timerId = null;
    let pendingArgs = null;

    const cancel = () => {
        if (timerId) {
            clearTimeout(timerId);
            timerId = null;
        }
        // Do NOT clear pendingArgs on cancel — flush may follow
    };

    const flush = () => {
        cancel();
        if (pendingArgs) {
            const args = pendingArgs;
            pendingArgs = null;
            fn(...args);
        }
    };

    const call = (...args) => {
        pendingArgs = args;
        cancel();
        timerId = setTimeout(() => {
            const a = pendingArgs;
            pendingArgs = null;
            timerId = null;
            if (a) fn(...a);
        }, delay);
    };

    return { call, flush, cancel };
};

// ── Path Sanitizer (client-side defense-in-depth) ──────────────
export const sanitizePath = (filePath) => {
    if (!filePath) return '/root/index.js';
    if (filePath.includes('..')) {
        console.warn('⚠️ Path traversal attempt blocked:', filePath);
        return '/root/index.js';
    }
    return filePath;
};
