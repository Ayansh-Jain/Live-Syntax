import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import "codemirror/mode/javascript/javascript";
import "codemirror/mode/python/python";
import "codemirror/mode/clike/clike";
import "codemirror/mode/htmlmixed/htmlmixed";
import "codemirror/mode/css/css";
import "codemirror/mode/xml/xml";
import "codemirror/mode/markdown/markdown";
import "codemirror/mode/sql/sql";
import "codemirror/theme/dracula.css";
import "codemirror/addon/edit/closetag";
import "codemirror/addon/edit/closebrackets";
import "codemirror/addon/selection/mark-selection";
import "codemirror/lib/codemirror.css";
import CodeMirror from "codemirror";
import { ACTIONS } from "../Actions";
import { generateOpId, createFlushableDebounce, transformCursor, sanitizePath } from "../syncUtils";

// Helper function to generate consistent color from username
const getUserColor = (username) => {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 60%)`;
};

// Helper to convert HSL to RGBA with alpha
const getUserColorWithAlpha = (username, alpha = 0.3) => {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  const l = 60;
  const s = 70;
  const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l / 100 - c / 2;
  let r = 0, g = 0, b = 0;

  if (hue >= 0 && hue < 60) { r = c; g = x; b = 0; }
  else if (hue >= 60 && hue < 120) { r = x; g = c; b = 0; }
  else if (hue >= 120 && hue < 180) { r = 0; g = c; b = x; }
  else if (hue >= 180 && hue < 240) { r = 0; g = x; b = c; }
  else if (hue >= 240 && hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const MAX_QUEUE_SIZE = 50; // FIX 8: Backpressure threshold

const Editor = forwardRef(function Editor(
  { socketRef, roomId, onCodeChange, activeFile, fileContent, language, fileVersionsRef, isEditorFrozen },
  ref
) {
  const editorRef = useRef(null);
  const remoteCursorsRef = useRef({});
  const remoteSelectionsRef = useRef({});
  const suppressRemoteChangeRef = useRef(false);
  const currentFileRef = useRef(activeFile);
  const pendingOpsQueueRef = useRef([]);
  const debouncedEmitRef = useRef(null);

  // Expose flush() to parent via ref
  useImperativeHandle(ref, () => ({
    flush: () => {
      if (debouncedEmitRef.current) debouncedEmitRef.current.flush();
    },
    getEditor: () => editorRef.current,
    getPendingOpsQueue: () => pendingOpsQueueRef.current,
  }));

  // Keep currentFileRef in sync with activeFile prop
  useEffect(() => {
    currentFileRef.current = activeFile;
  }, [activeFile]);

  // BUG 15: Freeze/unfreeze editor
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.setOption('readOnly', isEditorFrozen ? true : false);
    }
  }, [isEditorFrozen]);

  useEffect(() => {
    const init = async () => {
      const editor = CodeMirror.fromTextArea(
        document.getElementById("realtimeEditor"),
        {
          mode: { name: language || "javascript", json: true },
          theme: "dracula",
          autoCloseTags: true,
          autoCloseBrackets: true,
          lineNumbers: true,
        }
      );

      editorRef.current = editor;
      editor.setSize(null, "100%");

      // ── Sync helper: emits CODE_CHANGE with proper versioning ──
      const syncCurrentContent = (filePath) => {
        const code = editor.getValue();

        // Update React state (EditorPage) — only on actual sync, not per keystroke
        onCodeChange(code, filePath);

        // Increment version ONCE for this batch
        if (!fileVersionsRef.current[filePath]) fileVersionsRef.current[filePath] = 0;
        fileVersionsRef.current[filePath] += 1;
        const version = fileVersionsRef.current[filePath];
        const opId = generateOpId();

        // Backpressure check
        const sameFileOps = pendingOpsQueueRef.current.filter(op => op.filePath === filePath);
        if (sameFileOps.length > MAX_QUEUE_SIZE) {
          pendingOpsQueueRef.current = pendingOpsQueueRef.current.filter(op => op.filePath !== filePath);
        }

        // Push to pending queue
        pendingOpsQueueRef.current.push({ opId, filePath, version, code, change: null });

        // Emit full code (batched, no delta — safe for multi-keystroke batches)
        socketRef.current.emit(ACTIONS.CODE_CHANGE, {
          roomId, code, change: null, filePath, version, opId,
        }, (ack) => handleAck(ack, opId, filePath));
      };

      // ── Flushable debounce — fires after 1s of no typing ──
      debouncedEmitRef.current = createFlushableDebounce((filePath) => {
        syncCurrentContent(filePath);
      }, 1000);

      // ── ACK handler ──
      const handleAck = (ack, opId, filePath) => {
        if (!ack) return;
        if (ack.status === 'ok') {
          // Remove from pending queue (do NOT overwrite fileVersionsRef — client version may be ahead)
          pendingOpsQueueRef.current = pendingOpsQueueRef.current.filter(op => op.opId !== opId);
        }
        // conflict is handled by EditorPage's CODE_CONFLICT listener
      };

      // Send cursor position changes (BUG 4: include filePath)
      editor.on("cursorActivity", () => {
        if (!suppressRemoteChangeRef.current) {
          const cursor = editor.getCursor();
          const selection = editor.listSelections()[0];
          socketRef.current.emit(ACTIONS.CURSOR_CHANGE, {
            roomId,
            cursor,
            selection,
            filePath: currentFileRef.current,
          });
        }
      });

      // ── onChange: sole CODE_CHANGE emitter (BUG 11) ──
      // User types freely — NO state updates or version increments per keystroke.
      // Sync happens on: spacebar, enter, paste, or 1s idle.
      editor.on("change", (instance, changeObj) => {
        const { origin } = changeObj;
        if (origin === "setValue" || suppressRemoteChangeRef.current) return;

        const filePath = sanitizePath(currentFileRef.current || '/root/index.js');

        // Detect spacebar, enter (empty string in text array = newline), or paste
        const isBreakChar = changeObj.text.some(t => t.includes(' ') || t === '');
        const isPaste = origin === 'paste';

        if (isBreakChar || isPaste) {
          // Immediate sync: cancel pending debounce and sync NOW
          debouncedEmitRef.current.cancel();
          syncCurrentContent(filePath);
        } else {
          // Regular keystroke: just schedule debounce, let user type freely
          debouncedEmitRef.current.call(filePath);
        }
      });
    };

    init();

    // BUG 15: Cleanup CodeMirror on unmount
    return () => {
      if (editorRef.current) {
        editorRef.current.toTextArea();
        editorRef.current = null;
      }
    };
  }, []);

  // Update editor content when active file changes or external content arrives
  useEffect(() => {
    if (editorRef.current && activeFile) {
      currentFileRef.current = activeFile;

      // Skip setValue if editor already has this content — prevents feedback loop
      // during local typing (type → handleCodeChange → fileContent prop change → here)
      const currentContent = editorRef.current.getValue();
      if (currentContent === (fileContent || "")) {
        // Still update language mode if needed
        if (language) editorRef.current.setOption("mode", language);
        return;
      }

      suppressRemoteChangeRef.current = true;

      const cursor = editorRef.current.getCursor();
      editorRef.current.setValue(fileContent || "");
      editorRef.current.setCursor(cursor);

      if (language) {
        editorRef.current.setOption("mode", language);
      }

      setTimeout(() => {
        suppressRemoteChangeRef.current = false;
      }, 10);
    }
  }, [activeFile, language, fileContent]);

  // Handle incoming code and cursor changes
  useEffect(() => {
    if (socketRef.current) {
      // Handle remote code changes — only apply delta to active file's editor
      socketRef.current.on(ACTIONS.CODE_CHANGE, ({ code, change, filePath, version }) => {
        // BUG 4: Only apply to editor if this is the active file
        if (editorRef.current && filePath && filePath === currentFileRef.current) {
          suppressRemoteChangeRef.current = true;

          // FIX 6: Apply delta if available, otherwise full sync
          if (change && change.from && change.to && change.text) {
            editorRef.current.replaceRange(
              change.text.join('\n'),
              change.from,
              change.to,
              '+input'
            );

            // FIX 9: Transform all remote cursor bookmarks after applying delta
            Object.keys(remoteCursorsRef.current).forEach((sid) => {
              const bookmark = remoteCursorsRef.current[sid];
              if (bookmark) {
                const pos = bookmark.find();
                if (pos) {
                  const newPos = transformCursor(pos, change);
                  if (newPos && (newPos.line !== pos.line || newPos.ch !== pos.ch)) {
                    bookmark.clear();
                    remoteCursorsRef.current[sid] = editorRef.current.setBookmark(newPos, {
                      widget: bookmark.widgetNode,
                      insertLeft: true,
                    });
                  }
                }
              }
            });
          } else if (code !== null) {
            const cursor = editorRef.current.getCursor();
            const scrollInfo = editorRef.current.getScrollInfo();
            editorRef.current.setValue(code);
            editorRef.current.setCursor(cursor);
            editorRef.current.scrollTo(scrollInfo.left, scrollInfo.top);
          }

          setTimeout(() => {
            suppressRemoteChangeRef.current = false;
          }, 10);
        }
        // NOTE: Background file caching is handled by EditorPage's CODE_CHANGE listener
      });

      // Handle remote cursor changes (BUG 4: filter by filePath)
      socketRef.current.on(ACTIONS.CURSOR_CHANGE, ({ socketId, username, cursor, selection, filePath }) => {
        if (!editorRef.current) return;
        // Only show cursors for the same file
        if (filePath && filePath !== currentFileRef.current) return;

        const color = getUserColor(username);
        const bgColor = getUserColorWithAlpha(username, 0.6);

        // Remove old cursor if exists
        if (remoteCursorsRef.current[socketId]) {
          remoteCursorsRef.current[socketId].clear();
        }
        if (remoteSelectionsRef.current[socketId]) {
          remoteSelectionsRef.current[socketId].clear();
        }

        // Create cursor widget
        const cursorCoords = editorRef.current.cursorCoords(cursor);
        const cursorElement = document.createElement("span");
        cursorElement.style.borderLeft = `2px solid ${color}`;
        cursorElement.style.height = `${cursorCoords.bottom - cursorCoords.top}px`;
        cursorElement.style.position = "absolute";
        cursorElement.style.zIndex = "10";

        // Add username label
        const label = document.createElement("span");
        label.textContent = username;
        label.style.position = "absolute";
        label.style.top = "-18px";
        label.style.left = "0";
        label.style.fontSize = "10px";
        label.style.backgroundColor = color;
        label.style.color = "white";
        label.style.padding = "2px 4px";
        label.style.borderRadius = "3px";
        label.style.whiteSpace = "nowrap";
        cursorElement.appendChild(label);

        remoteCursorsRef.current[socketId] = editorRef.current.setBookmark(cursor, {
          widget: cursorElement,
          insertLeft: true,
        });

        // Highlight selection if exists
        const hasSelection = selection && selection.anchor && selection.head &&
          (selection.anchor.line !== selection.head.line ||
           selection.anchor.ch !== selection.head.ch);

        if (hasSelection) {
          let from = selection.anchor;
          let to = selection.head;
          if (from.line > to.line || (from.line === to.line && from.ch > to.ch)) {
            [from, to] = [to, from];
          }

          const selectionClass = `remote-selection-${socketId.replace(/[^a-zA-Z0-9]/g, '')}`;
          const styleId = `style-${socketId.replace(/[^a-zA-Z0-9]/g, '')}`;
          let styleElement = document.getElementById(styleId);
          if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = styleId;
            document.head.appendChild(styleElement);
          }
          styleElement.textContent = `
            .${selectionClass} {
              background-color: ${bgColor} !important;
              background: ${bgColor} !important;
            }
          `;

          try {
            const mark = editorRef.current.markText(from, to, {
              className: selectionClass,
              inclusiveLeft: true,
              inclusiveRight: true,
            });
            remoteSelectionsRef.current[socketId] = mark;
          } catch (err) {
            // Silent error handling
          }
        }
      });

      // Handle user disconnect - remove their cursor
      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId }) => {
        if (remoteCursorsRef.current[socketId]) {
          remoteCursorsRef.current[socketId].clear();
          delete remoteCursorsRef.current[socketId];
        }
        if (remoteSelectionsRef.current[socketId]) {
          remoteSelectionsRef.current[socketId].clear();
          delete remoteSelectionsRef.current[socketId];
        }
        const styleElement = document.getElementById(`style-${socketId}`);
        if (styleElement) {
          styleElement.remove();
        }
      });
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.off(ACTIONS.CODE_CHANGE);
        socketRef.current.off(ACTIONS.CURSOR_CHANGE);
        socketRef.current.off(ACTIONS.DISCONNECTED);
      }
    };
  }, [socketRef.current]);

  return (
    <div style={{ height: "600px" }}>
      <textarea id="realtimeEditor"></textarea>
    </div>
  );
});

export default Editor;
