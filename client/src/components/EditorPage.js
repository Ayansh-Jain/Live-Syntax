import React, { useEffect, useRef, useState } from "react";
import Client from "./Client";
import Editor from "./Editor";
import FileExplorer, { getLanguageFromFile } from "./FileExplorer";
import FileTabs from "./FileTabs";
import { initSocket } from "../Socket";
import { ACTIONS } from "../Actions";
import { SwitchSequencer, generateOpId } from "../syncUtils";
import {
  useNavigate,
  useLocation,
  Navigate,
  useParams,
} from "react-router-dom";
import { toast } from "react-hot-toast";
import axios from "axios";
import WebRTCManager from "../WebRTCManager";

// List of supported languages
const LANGUAGES = [
  "python3",
  "java",
  "cpp",
  "c",
];

// Initial file structure
const getInitialFileStructure = () => ({
  name: "root",
  type: "folder",
  children: {
    "index.js": {
      name: "index.js",
      type: "file",
      content: "// Welcome to Live Syntax!\n// Create files and folders to build your project\n",
    },
  },
});

function EditorPage() {
  const [clients, setClients] = useState([]);
  const [output, setOutput] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isCompileWindowOpen, setIsCompileWindowOpen] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("python3");
  const [programInput, setProgramInput] = useState("");
  const [joinRequests, setJoinRequests] = useState([]);
  const [isWaitingForApproval, setIsWaitingForApproval] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  
  // Sync state
  const [syncStatus, setSyncStatus] = useState("green"); // green/yellow/red
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isFileSyncing, setIsFileSyncing] = useState(false);

  // File system state
  const [fileStructure, setFileStructure] = useState(getInitialFileStructure());
  const [openFiles, setOpenFiles] = useState(["/root/index.js"]);
  const [activeFile, setActiveFile] = useState("/root/index.js");
  const [fileContents, setFileContents] = useState({
    "/root/index.js": "// Welcome to Live Syntax!\n// Create files and folders to build your project\n",
  });

  const codeRef = useRef(null);
  const editorRef = useRef(null); // ref to Editor component (for flush)
  const fileVersionsRef = useRef({}); // { filePath: version }
  const switchSeqRef = useRef(new SwitchSequencer());
  const fileSyncTimeoutRef = useRef(null);
  const activeFileRef = useRef(activeFile);
  // BUG 13: refs that mirror state to avoid stale closures
  const fileStructureRef = useRef(fileStructure);
  const fileContentsRef = useRef(fileContents);

  // Keep refs in sync with state (BUG 13 fix)
  useEffect(() => { fileStructureRef.current = fileStructure; }, [fileStructure]);
  useEffect(() => { fileContentsRef.current = fileContents; }, [fileContents]);
  useEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);

  // Safeguard: Save current file content before switching
  useEffect(() => {
    return () => {
      if (codeRef.current !== null && activeFile) {
        setFileContents((prevContents) => ({
          ...prevContents,
          [activeFile]: codeRef.current,
        }));
      }
    };
  }, [activeFile]);

  // Panel resize state
  const [leftPanelWidth, setLeftPanelWidth] = useState(20); // percentage
  const [rightPanelWidth, setRightPanelWidth] = useState(20); // percentage
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const containerRef = useRef(null);

  const Location = useLocation();
  const navigate = useNavigate();
  const { roomId } = useParams();

  const socketRef = useRef(null);
  const webrtcManagerRef = useRef(null);

  // Ensure active file is initialized in fileContents when tab switching
  useEffect(() => {
    if (activeFile && !fileContents[activeFile]) {
      setFileContents((prevContents) => ({
        ...prevContents,
        [activeFile]: "",
      }));
    }
  }, [activeFile]);

  useEffect(() => {
    const init = async () => {
      const handleErrors = (err) => {
        console.log("Error", err);
        toast.error("Socket connection failed, Try again later");
        navigate("/");
      };

      socketRef.current = await initSocket();
      socketRef.current.on("connect_error", (err) => handleErrors(err));
      socketRef.current.on("connect_failed", (err) => handleErrors(err));

      socketRef.current.emit(ACTIONS.JOIN, {
        roomId,
        username: Location.state?.username,
      });

      socketRef.current.on(
        ACTIONS.JOINED,
        ({ clients, username, socketId }) => {
          setIsWaitingForApproval(false);
          
          if (username !== Location.state?.username) {
            toast.success(`${username} joined the room.`);
          }
          setClients(clients);
          
          // BUG 13 fix: read from refs to avoid stale closure
          socketRef.current.emit(ACTIONS.FILE_STRUCTURE_SYNC, {
            fileStructure: fileStructureRef.current,
            fileContents: fileContentsRef.current,
            socketId,
          });
        }
      );

      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
        toast.success(`${username} left the room`);
        setClients((prev) => prev.filter((client) => client.socketId !== socketId));
      });

      socketRef.current.on(ACTIONS.JOIN_REQUEST, ({ socketId, username }) => {
        setJoinRequests((prev) => [...prev, { socketId, username }]);
      });

      socketRef.current.on(ACTIONS.WAITING_FOR_APPROVAL, () => {
        setIsWaitingForApproval(true);
      });

      socketRef.current.on(ACTIONS.JOIN_REJECTED, () => {
        toast.error("The host rejected your request to join the room");
        navigate("/");
      });

      socketRef.current.on(ACTIONS.HOST_CHANGED, ({ newHostSocketId, newHostUsername, clients }) => {
        setClients(clients);
        if (newHostSocketId === socketRef.current.id) {
          toast.success("You are now the host!");
        } else {
          toast.success(`${newHostUsername} is now the host`);
        }
      });

      // Handle file structure sync (only for structural changes, not content)
      socketRef.current.on(ACTIONS.FILE_STRUCTURE_UPDATE, ({ fileStructure: newStructure, fileContents: newContents }) => {
        if (newStructure) setFileStructure(newStructure);
        if (newContents) {
          setFileContents((prev) => ({ ...prev, ...newContents }));
          // Update versions for any new files
          for (const fp of Object.keys(newContents)) {
            if (fileVersionsRef.current[fp] === undefined) fileVersionsRef.current[fp] = 0;
          }
        }
      });

      // ── CODE_CHANGE listener (BUG 11 fix: update ALL files) ──
      socketRef.current.on(ACTIONS.CODE_CHANGE, ({ code, filePath, version }) => {
        if (!filePath) return;
        // Update fileContents for ALL files (active + background)
        setFileContents((prev) => ({ ...prev, [filePath]: code }));
        // Update version tracking
        if (version !== undefined) {
          fileVersionsRef.current[filePath] = version;
        }
      });

      // ── FILE_SYNC_RESPONSE listener (BUGs 3, 5) ──
      socketRef.current.on(ACTIONS.FILE_SYNC_RESPONSE, ({ filePath, content, version, seq }) => {
        // FIX 10: Discard stale responses
        if (!switchSeqRef.current.isValid(seq)) return;
        if (fileSyncTimeoutRef.current) clearTimeout(fileSyncTimeoutRef.current);
        setFileContents((prev) => ({ ...prev, [filePath]: content }));
        fileVersionsRef.current[filePath] = version;
        setIsFileSyncing(false);
      });

      // ── CODE_CONFLICT listener (FIX 1: rebase) ──
      socketRef.current.on(ACTIONS.CODE_CONFLICT, ({ filePath, serverVersion, latestContent }) => {
        // Update local state with authoritative content
        fileVersionsRef.current[filePath] = serverVersion;
        setFileContents((prev) => ({ ...prev, [filePath]: latestContent }));

        // Rebase pending ops (FIX 1)
        if (editorRef.current) {
          const queue = editorRef.current.getPendingOpsQueue();
          const opsForFile = queue.filter(op => op.filePath === filePath);
          if (opsForFile.length > 0) {
            let baseVersion = serverVersion;
            for (const op of opsForFile) {
              baseVersion += 1;
              op.version = baseVersion;
              op.opId = generateOpId();
            }
            fileVersionsRef.current[filePath] = baseVersion;
            // Resend rebased ops
            for (const op of opsForFile) {
              socketRef.current.emit(ACTIONS.CODE_CHANGE, {
                roomId, filePath, code: op.code, change: op.change,
                version: op.version, opId: op.opId,
              });
            }
          }
        }
        toast("Sync conflict resolved — content updated from server", { icon: "⚠️" });
        setSyncStatus("yellow");
        setTimeout(() => setSyncStatus("green"), 3000);
      });

      // ── SAVE_ERROR listener (BUG 9) ──
      socketRef.current.on(ACTIONS.SAVE_ERROR, ({ filePath, error }) => {
        toast.error(`Save failed for ${filePath}: ${error}`);
        setSyncStatus("red");
        setTimeout(() => setSyncStatus("green"), 5000);
      });

      // ── Disconnect/Reconnect (BUG 6, FIX 3, FIX 7) ──
      socketRef.current.on('disconnect', () => {
        // FIX 7: FLUSH debounce, not cancel
        if (editorRef.current) editorRef.current.flush();
        setIsReconnecting(true);
      });

      socketRef.current.on('reconnect', () => {
        const currentFile = activeFileRef.current;
        socketRef.current.emit(ACTIONS.RECONNECT_SYNC_START, { roomId, filePath: currentFile });
      });

      socketRef.current.on(ACTIONS.RECONNECT_SYNC_DONE, ({ filePath, content, version }) => {
        // FIX 3: Rebase pending ops instead of clearing
        fileVersionsRef.current[filePath] = version;
        setFileContents((prev) => ({ ...prev, [filePath]: content }));

        if (editorRef.current) {
          const queue = editorRef.current.getPendingOpsQueue();
          const opsForFile = queue.filter(op => op.filePath === filePath);
          let baseVersion = version;
          for (const op of opsForFile) {
            baseVersion += 1;
            op.version = baseVersion;
            op.opId = generateOpId();
          }
          fileVersionsRef.current[filePath] = baseVersion;
          for (const op of opsForFile) {
            socketRef.current.emit(ACTIONS.CODE_CHANGE, {
              roomId, filePath, code: op.code, change: op.change,
              version: op.version, opId: op.opId,
            });
          }
        }

        setIsReconnecting(false);
        setSyncStatus("green");
        // Re-join the room
        socketRef.current.emit(ACTIONS.JOIN, { roomId, username: Location.state?.username });
      });

      // ── beforeunload: flush pending edits ──
      const handleBeforeUnload = () => {
        if (editorRef.current) editorRef.current.flush();
      };
      window.addEventListener('beforeunload', handleBeforeUnload);

      // Store cleanup ref for beforeunload
      socketRef.current._beforeUnloadHandler = handleBeforeUnload;
    };
    init();

    return () => {
      // Cleanup beforeunload
      if (socketRef.current?._beforeUnloadHandler) {
        window.removeEventListener('beforeunload', socketRef.current._beforeUnloadHandler);
      }
      // Cleanup WebRTC before disconnecting socket
      if (webrtcManagerRef.current) {
        webrtcManagerRef.current.cleanup();
      }
      // BUG 16: Unregister listeners FIRST, then disconnect
      if (socketRef.current) {
        socketRef.current.off(ACTIONS.JOINED);
        socketRef.current.off(ACTIONS.DISCONNECTED);
        socketRef.current.off(ACTIONS.JOIN_REQUEST);
        socketRef.current.off(ACTIONS.JOIN_REJECTED);
        socketRef.current.off(ACTIONS.WAITING_FOR_APPROVAL);
        socketRef.current.off(ACTIONS.HOST_CHANGED);
        socketRef.current.off(ACTIONS.FILE_STRUCTURE_UPDATE);
        socketRef.current.off(ACTIONS.CODE_CHANGE);
        socketRef.current.off(ACTIONS.FILE_SYNC_RESPONSE);
        socketRef.current.off(ACTIONS.CODE_CONFLICT);
        socketRef.current.off(ACTIONS.SAVE_ERROR);
        socketRef.current.off(ACTIONS.RECONNECT_SYNC_DONE);
        socketRef.current.off('disconnect');
        socketRef.current.off('reconnect');
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Handle panel resizing
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!containerRef.current) return;

      if (isResizingLeft) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const newLeftWidth = Math.max(15, Math.min(50, (e.clientX / containerRect.width) * 100));
        setLeftPanelWidth(newLeftWidth);
      } else if (isResizingRight) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const newRightWidth = Math.max(15, Math.min(50, ((containerRect.width - e.clientX) / containerRect.width) * 100));
        setRightPanelWidth(newRightWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
    };

    if (isResizingLeft || isResizingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizingLeft, isResizingRight]);

  if (!Location.state) {
    return <Navigate to="/" />;
  }

  // Show waiting screen if user is pending approval
  if (isWaitingForApproval) {
    return (
      <div className="container-fluid vh-100 d-flex justify-content-center align-items-center bg-dark">
        <div className="text-center text-light">
          <div className="spinner-border text-primary mb-4" role="status" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          <h3>Waiting for host approval...</h3>
          <p className="text-muted">The host will review your request to join the room</p>
          <button className="btn btn-outline-danger mt-3" onClick={() => navigate("/")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success(`Room ID is copied`);
    } catch (error) {
      console.log(error);
      toast.error("Unable to copy the room ID");
    }
  };

  const leaveRoom = async () => {
    navigate("/");
  };

  // File system helper functions
  const setItemAtPath = (structure, path, item) => {
    const parts = path.split('/').filter(p => p && p !== 'root');
    let current = structure;
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current.children[parts[i]]) {
        current.children[parts[i]] = { name: parts[i], type: 'folder', children: {} };
      }
      current = current.children[parts[i]];
    }
    
    const lastName = parts[parts.length - 1];
    current.children[lastName] = item;
    return { ...structure };
  };

  const deleteItemAtPath = (structure, path) => {
    const parts = path.split('/').filter(p => p && p !== 'root');
    let current = structure;
    
    for (let i = 0; i < parts.length - 1; i++) {
      current = current.children[parts[i]];
    }
    
    const lastName = parts[parts.length - 1];
    delete current.children[lastName];
    return { ...structure };
  };

  const handleFileSelect = (path, content) => {
    // Add to open tabs if not already open
    if (!openFiles.includes(path)) {
      setOpenFiles((prev) => [...prev, path]);
    }
    // Initialize content if this file has never been seen
    if (!fileContentsRef.current[path]) {
      setFileContents((prev) => ({ ...prev, [path]: content || "" }));
    }
    // Delegate to handleTabSelect for proper flush + REQUEST_FILE_SYNC
    handleTabSelect(path);
  };

  const handleTabSelect = (path) => {
    // FIX 10: Flush pending edits for current file
    if (editorRef.current) editorRef.current.flush();

    // Read content directly from editor (codeRef may not be updated per keystroke)
    if (activeFile && editorRef.current?.getEditor()) {
      const currentContent = editorRef.current.getEditor().getValue();
      codeRef.current = currentContent;
      setFileContents((prevContents) => ({
        ...prevContents, [activeFile]: currentContent,
      }));
    } else if (activeFile && codeRef.current !== null) {
      setFileContents((prevContents) => ({
        ...prevContents, [activeFile]: codeRef.current,
      }));
    }

    // FIX 10: Increment seq — invalidates any inflight response
    const seq = switchSeqRef.current.next();

    // Cancel any pending file-sync timeout
    if (fileSyncTimeoutRef.current) clearTimeout(fileSyncTimeoutRef.current);

    // Optimistic preview from background cache (instant)
    setFileContents((prevContents) => {
      if (!prevContents[path]) return { ...prevContents, [path]: "" };
      return prevContents;
    });
    setActiveFile(path);

    // Request authoritative content from server
    if (socketRef.current) {
      socketRef.current.emit(ACTIONS.REQUEST_FILE_SYNC, { roomId, filePath: path, seq });
      setIsFileSyncing(true);

      // FIX 10: Timeout fallback — if server doesn't respond in 3s, use cache
      fileSyncTimeoutRef.current = setTimeout(() => {
        if (switchSeqRef.current.isValid(seq)) {
          setIsFileSyncing(false);
        }
      }, 3000);
    }
  };

  const handleCloseFile = (path) => {
    // Save this file's content before closing it
    if (codeRef.current !== null && path === activeFile) {
      setFileContents((prevContents) => ({
        ...prevContents,
        [path]: codeRef.current,
      }));
      console.log("💾 SAVED file before closing:", { path });
    }
    
    const newOpenFiles = openFiles.filter(f => f !== path);
    setOpenFiles(newOpenFiles);
    
    if (activeFile === path && newOpenFiles.length > 0) {
      setActiveFile(newOpenFiles[newOpenFiles.length - 1]);
    }
  };

  const handleCreateFile = (path) => {
    const fileName = path.split('/').pop();
    const newStructure = setItemAtPath(fileStructure, path, {
      name: fileName,
      type: 'file',
      content: '',
    });
    
    setFileStructure(newStructure);
    setFileContents({ ...fileContents, [path]: '' });
    setOpenFiles([...openFiles, path]);
    setActiveFile(path);
    
    // Broadcast to all users
    socketRef.current.emit(ACTIONS.FILE_CREATE, {
      roomId,
      path,
      fileName,
    });
  };

  const handleCreateFolder = (path) => {
    const folderName = path.split('/').pop();
    const newStructure = setItemAtPath(fileStructure, path, {
      name: folderName,
      type: 'folder',
      children: {},
    });
    
    setFileStructure(newStructure);
    
    // Broadcast to all users
    socketRef.current.emit(ACTIONS.FOLDER_CREATE, {
      roomId,
      path,
      folderName,
    });
  };

  const handleDeleteItem = (path) => {
    const newStructure = deleteItemAtPath(fileStructure, path);
    setFileStructure(newStructure);
    
    // Close file if open
    if (openFiles.includes(path)) {
      handleCloseFile(path);
    }
    
    // Remove from fileContents
    const newContents = { ...fileContents };
    delete newContents[path];
    setFileContents(newContents);
    
    // Broadcast to all users
    socketRef.current.emit(ACTIONS.FILE_DELETE, {
      roomId,
      path,
    });
  };

  const handleRenameItem = (oldPath, newPath) => {
    // Get item at old path
    const parts = oldPath.split('/').filter(p => p && p !== 'root');
    let current = fileStructure;
    
    for (let i = 0; i < parts.length - 1; i++) {
      current = current.children[parts[i]];
    }
    
    const item = current.children[parts[parts.length - 1]];
    
    // Update name
    const newName = newPath.split('/').pop();
    const updatedItem = { ...item, name: newName };
    
    // Delete old and add new
    let newStructure = deleteItemAtPath(fileStructure, oldPath);
    newStructure = setItemAtPath(newStructure, newPath, updatedItem);
    setFileStructure(newStructure);
    
    // Update open files
    if (openFiles.includes(oldPath)) {
      setOpenFiles(openFiles.map(f => f === oldPath ? newPath : f));
    }
    
    // Update active file
    if (activeFile === oldPath) {
      setActiveFile(newPath);
    }
    
    // Update file contents
    if (fileContents[oldPath]) {
      const newContents = { ...fileContents };
      newContents[newPath] = newContents[oldPath];
      delete newContents[oldPath];
      setFileContents(newContents);
    }
    
    // Broadcast to all users
    socketRef.current.emit(ACTIONS.FILE_RENAME, {
      roomId,
      oldPath,
      newPath,
    });
  };

  // BUG 11 fix: handleCodeChange only updates LOCAL state — no socket emit
  // Editor.js is the sole CODE_CHANGE emitter
  const handleCodeChange = (code, filePath = activeFile) => {
    codeRef.current = code;
    if (!filePath) return;
    setFileContents((prevContents) => ({ ...prevContents, [filePath]: code }));
    setSyncStatus("yellow");
  };

  const handleApproveJoin = (socketId, username) => {
    socketRef.current.emit(ACTIONS.APPROVE_JOIN, { socketId, roomId });
    setJoinRequests((prev) => prev.filter((req) => req.socketId !== socketId));
    toast.success(`${username} has been approved to join`);
  };

  const handleRejectJoin = (socketId, username) => {
    socketRef.current.emit(ACTIONS.REJECT_JOIN, { socketId, roomId });
    setJoinRequests((prev) => prev.filter((req) => req.socketId !== socketId));
    toast.success(`${username}'s request has been rejected`);
  };

  const runCode = async () => {
    setIsCompiling(true);
    try {
      // Get the code from the active file
      const currentCode = fileContents[activeFile] || "";
      
      const response = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/compile`, {
        code: currentCode,
        language: selectedLanguage,
        input: programInput, // Include program input
      });
      console.log("Backend response:", response.data);
      setOutput(response.data.output || JSON.stringify(response.data));
    } catch (error) {
      console.error("Error compiling code:", error);
      setOutput(error.response?.data?.error || "An error occurred");
    } finally {
      setIsCompiling(false);
    }
  };

  const sendAiPrompt = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    setAiResponse("");
    try {
      // Get the code from the active file
      const currentCode = fileContents[activeFile] || "";
      const fileExtension = activeFile ? activeFile.split('.').pop() : 'js';
      
      const response = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/ai`, {
        prompt: aiPrompt,
        code: currentCode,
        language: fileExtension,
      });
      setAiResponse(response.data.reply || JSON.stringify(response.data));
    } catch (err) {
      console.error("AI error", err);
      const errorDetails = err.response?.data?.details || err.response?.data?.error || err.message;
      setAiResponse(`Error: ${errorDetails}\n\nPlease check:\n1. Your Groq API key is valid (get free at https://console.groq.com)\n2. The key is added to server/.env\n3. The server is running`);
    } finally {
      setIsAiLoading(false);
    }
  };

  const toggleCompileWindow = () => {
    setIsCompileWindowOpen(!isCompileWindowOpen);
  };

  // Voice call handlers
  const handleJoinCall = async () => {
    try {
      // Always create a fresh WebRTCManager instance to avoid stale state
      if (webrtcManagerRef.current) {
        webrtcManagerRef.current.cleanup();
      }
      
      webrtcManagerRef.current = new WebRTCManager(
        socketRef,
        roomId,
        Location.state?.username
      );

      await webrtcManagerRef.current.joinCall(clients);
      setIsInCall(true);
      toast.success("Joined voice call");
    } catch (error) {
      console.error("Error joining call:", error);
      toast.error(error.message || "Failed to join call");
    }
  };

  const handleLeaveCall = () => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.leaveCall();
      setIsInCall(false);
      setIsMuted(false);
      toast.success("Left voice call");
    }
  };

  const handleToggleMute = () => {
    if (webrtcManagerRef.current) {
      const muted = webrtcManagerRef.current.toggleMute();
      setIsMuted(muted);
      toast.success(muted ? "Microphone muted" : "Microphone unmuted");
    }
  };

  const handleSaveProject = async () => {
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_BACKEND_URL}/save-project`,
        {
          roomId,
          fileStructure,
          fileContents,
          projectName: `Project-${roomId.slice(0, 8)}`,
        }
      );
      toast.success("Project saved successfully!");
      console.log("Project saved:", response.data);
    } catch (err) {
      console.error("Error saving project:", err);
      toast.error(err.response?.data?.error || "Failed to save project");
    }
  };

  return (
    <div className="container-fluid vh-100 d-flex flex-column" ref={containerRef}>
      {/* Join Requests Modal/Notification */}
      {joinRequests.length > 0 && (
        <div
          className="position-fixed top-0 start-50 translate-middle-x mt-3"
          style={{ zIndex: 2000, maxWidth: "500px", width: "90%" }}
        >
          <div className="card bg-dark border-primary shadow-lg">
            <div className="card-header bg-primary text-white d-flex justify-content-between align-items-center">
              <h6 className="mb-0">
                <i className="bi bi-bell-fill me-2"></i>
                Join Requests ({joinRequests.length})
              </h6>
            </div>
            <div className="card-body p-2" style={{ maxHeight: "300px", overflowY: "auto" }}>
              {joinRequests.map((request, index) => (
                <div
                  key={request.socketId}
                  className={`d-flex justify-content-between align-items-center p-3 ${
                    index !== joinRequests.length - 1 ? "border-bottom border-secondary" : ""
                  }`}
                  style={{ backgroundColor: "#1a1d29" }}
                >
                  <div className="text-light">
                    <strong className="fs-6">{request.username}</strong>
                    <small className="d-block text-muted">wants to join the room</small>
                  </div>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-success btn-sm px-3"
                      onClick={() => handleApproveJoin(request.socketId, request.username)}
                      title="Approve"
                    >
                      <i className="bi bi-check-lg"></i> Allow
                    </button>
                    <button
                      className="btn btn-danger btn-sm px-3"
                      onClick={() => handleRejectJoin(request.socketId, request.username)}
                      title="Reject"
                    >
                      <i className="bi bi-x-lg"></i> Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexGrow: 1, background: 'var(--bg-primary)' }}>
        {/* Left Panel */}
        <div 
          style={{ 
            width: `${leftPanelWidth}%`,
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            display: 'flex',
            flexDirection: 'column',
            minWidth: '220px',
            overflow: 'hidden',
            borderRight: '1px solid var(--border)',
          }}
        >
          {/* Brand */}
          <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="bi bi-braces" style={{ fontSize: 20, background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }} />
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px' }}>
              <span style={{ background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Live</span> Syntax
            </span>
          </div>

          {/* Members */}
          <div style={{ borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ padding: '10px 16px 6px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Members · {clients.length}
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto', paddingBottom: 6 }}>
              {clients.map((client) => (
                <Client 
                  key={client.socketId} 
                  username={client.username} 
                  isHost={client.isHost}
                  inCall={client.socketId === socketRef.current?.id && isInCall}
                />
              ))}
            </div>
          </div>
          
          {/* File Explorer */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <FileExplorer
              fileStructure={fileStructure}
              onFileSelect={handleFileSelect}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onDeleteItem={handleDeleteItem}
              onRenameItem={handleRenameItem}
            />
          </div>

          {/* Action buttons */}
          <div style={{ padding: '12px', borderTop: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {!isInCall ? (
              <button onClick={handleJoinCall} title="Join voice call with room members" style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all var(--transition-fast)', fontFamily: 'Inter, sans-serif' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-glow)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <i className="bi bi-telephone-fill" /> Join Call
              </button>
            ) : (
              <>
                <button onClick={handleLeaveCall} title="Leave voice call" style={{ width: '100%', padding: '8px 12px', background: 'rgba(248,81,73,0.1)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'Inter, sans-serif' }}>
                  <i className="bi bi-telephone-x-fill" /> Leave Call
                </button>
                <button onClick={handleToggleMute} title={isMuted ? "Unmute" : "Mute"} style={{ width: '100%', padding: '8px 12px', background: isMuted ? 'rgba(210,153,34,0.1)' : 'transparent', border: `1px solid ${isMuted ? 'var(--warning)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', color: isMuted ? 'var(--warning)' : 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'Inter, sans-serif' }}>
                  <i className={`bi ${isMuted ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`} /> {isMuted ? 'Unmute' : 'Mute'}
                </button>
              </>
            )}
            <button onClick={handleSaveProject} style={{ width: '100%', padding: '8px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all var(--transition-fast)', fontFamily: 'Inter, sans-serif' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <i className="bi bi-cloud-arrow-up" /> Save Project
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={copyRoomId} style={{ flex: 1, padding: '8px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all var(--transition-fast)', fontFamily: 'Inter, sans-serif' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <i className="bi bi-copy me-1" /> Copy ID
              </button>
              <button onClick={leaveRoom} style={{ flex: 1, padding: '8px 12px', background: 'transparent', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all var(--transition-fast)', fontFamily: 'Inter, sans-serif' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,81,73,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <i className="bi bi-box-arrow-left me-1" /> Leave
              </button>
            </div>
          </div>
        </div>

        {/* Left Resize Handle */}
        <div
          onMouseDown={() => setIsResizingLeft(true)}
          style={{
            width: 3,
            backgroundColor: isResizingLeft ? 'var(--accent)' : 'var(--border)',
            cursor: 'col-resize',
            transition: isResizingLeft ? 'none' : 'background-color 0.2s',
            userSelect: 'none',
          }}
          title="Drag to resize"
        />

        {/* Middle Panel - Editor */}
        <div 
          style={{ 
            flex: 1,
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
            overflow: 'hidden'
          }}
        >
          {/* File Tabs */}
          <FileTabs
            openFiles={openFiles}
            activeFile={activeFile}
            onSelectFile={handleTabSelect}
            onCloseFile={handleCloseFile}
          />

          {/* Language selector */}
          <div className="bg-dark p-2 d-flex justify-content-between align-items-center border-bottom border-secondary">
            <span className="text-muted" style={{ fontSize: '0.85rem' }}>
              {activeFile && <><i className="bi bi-file-earmark-code me-2"></i>{activeFile}</>}
            </span>
            <select
              className="form-select w-auto"
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          {/* Sync status indicator */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', backgroundColor: '#1e1e1e', borderBottom: '1px solid #333' }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: syncStatus === 'green' ? '#4ade80' : syncStatus === 'yellow' ? '#facc15' : '#f87171',
              display: 'inline-block', marginRight: 8,
            }} title={`Sync: ${syncStatus}`} />
            <span style={{ fontSize: 11, color: '#888' }}>
              {isFileSyncing ? 'Syncing file...' : syncStatus === 'green' ? 'Synced' : syncStatus === 'yellow' ? 'Saving...' : 'Error'}
            </span>
          </div>

          <Editor
            ref={editorRef}
            socketRef={socketRef}
            roomId={roomId}
            onCodeChange={handleCodeChange}
            activeFile={activeFile}
            fileContent={fileContents[activeFile] || ""}
            language={activeFile ? getLanguageFromFile(activeFile) : "javascript"}
            fileVersionsRef={fileVersionsRef}
            isEditorFrozen={isReconnecting || isFileSyncing}
          />

          {/* Reconnecting overlay */}
          {isReconnecting && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            }}>
              <div style={{ color: '#fff', textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>🔄</div>
                <div>Reconnecting...</div>
              </div>
            </div>
          )}
        </div>

        {/* Right Resize Handle */}
        <div
          onMouseDown={() => setIsResizingRight(true)}
          style={{
            width: '5px',
            backgroundColor: isResizingRight ? '#0d6efd' : '#495057',
            cursor: 'col-resize',
            transition: isResizingRight ? 'none' : 'background-color 0.2s',
            userSelect: 'none',
          }}
          title="Drag to resize"
        />

        {/* Right Panel - AI Assistant */}
        <div 
          style={{ 
            width: `${rightPanelWidth}%`,
            backgroundColor: '#1a1d29',
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            minWidth: '200px',
            overflow: 'hidden',
            borderLeft: '1px solid #495057'
          }}
        >
          <div style={{ padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ marginBottom: '1rem' }}>
              <h5 style={{ color: 'white', marginBottom: '0.25rem', display: 'flex', alignItems: 'center' }}>
                <i className="bi bi-robot me-2" style={{ fontSize: '1.3rem' }}></i>
                AI Assistant
              </h5>
              <small style={{ color: '#adb5bd', fontSize: '0.8rem' }}>
                Get help with debugging, syntax, and code suggestions
              </small>
            </div>

            {/* Prompt Input */}
            <div style={{ marginBottom: '1rem' }}>
              <textarea
                className="form-control bg-secondary text-light border-0 shadow-sm"
                rows={5}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g., What's the error here? Fix this code. Explain this function..."
                style={{ 
                  resize: 'none',
                  fontSize: '0.9rem',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}
              />
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button 
                className="btn btn-primary flex-grow-1" 
                onClick={sendAiPrompt} 
                disabled={isAiLoading || !aiPrompt.trim()}
                style={{ fontWeight: '500' }}
              >
                {isAiLoading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                    Thinking...
                  </>
                ) : (
                  <>
                    <i className="bi bi-send me-2"></i>Ask AI
                  </>
                )}
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => { setAiPrompt(''); setAiResponse(''); }}
                title="Clear conversation"
                style={{ minWidth: '80px' }}
              >
                Clear
              </button>
            </div>

            {/* Response Area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, paddingBottom: '80px' }}>
              <h6 style={{ color: 'white', marginBottom: '0.5rem', display: 'flex', alignItems: 'center' }}>
                <i className="bi bi-chat-left-dots me-2"></i>Response
              </h6>
              <div 
                style={{ 
                  flex: 1,
                  backgroundColor: 'black',
                  color: 'white',
                  padding: '1rem',
                  borderRadius: '0.375rem',
                  border: '1px solid #495057',
                  overflowY: 'auto',
                  fontSize: '0.85rem',
                  lineHeight: '1.6',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  marginBottom: '10px'
                }}
              >
                {isAiLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#adb5bd' }}>
                    <div className="spinner-border spinner-border-sm mb-2" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                    <p style={{ marginBottom: 0 }}>Analyzing your request...</p>
                  </div>
                ) : aiResponse ? (
                  <pre style={{ marginBottom: 0, color: 'white', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                    {aiResponse}
                  </pre>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#adb5bd' }}>
                    <i className="bi bi-lightbulb" style={{ fontSize: '2rem', opacity: 0.3 }}></i>
                    <p style={{ marginTop: '0.5rem', marginBottom: 0, fontSize: '0.85rem' }}>
                      Ask me anything about your code!
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Compiler toggle button */}
      <button
        className="btn btn-outline-info position-fixed bottom-0 end-0 m-3"
        onClick={toggleCompileWindow}
        style={{ zIndex: 1050 }}
      >
        {isCompileWindowOpen ? "Close Compiler" : "Open Compiler"}
      </button>

      {/* Compiler section */}
      <div
        className={`bg-dark text-light p-3 ${
          isCompileWindowOpen ? "d-block" : "d-none"
        }`}
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: isCompileWindowOpen ? "30vh" : "0",
          transition: "height 0.3s ease-in-out",
          overflowY: "auto",
          zIndex: 1040,
        }}
      >
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h5 className="m-0">Compiler Output ({selectedLanguage})</h5>
          <div>
            <button
              className="btn btn-success me-2"
              onClick={runCode}
              disabled={isCompiling}
            >
              {isCompiling ? "Compiling..." : "Run Code"}
            </button>
            <button className="btn btn-secondary" onClick={toggleCompileWindow}>
              Close
            </button>
          </div>
        </div>

        {/* Program Input Section */}
        <div className="mb-3">
          <label className="form-label">
            <strong>Program Input:</strong> 
            <small className="text-muted ms-2">
              (For programs that require user input like cin, scanf, input(), etc.)
            </small>
          </label>
          <textarea
            className="form-control bg-dark text-light"
            rows="3"
            placeholder={`Enter input for your ${selectedLanguage} program here... `}
            value={programInput}
            onChange={(e) => setProgramInput(e.target.value)}
            style={{ 
              border: '1px solid #6c757d',
              fontSize: '14px',
              fontFamily: 'monospace'
            }}
          />
        </div>

        {/* Output Section */}
        <div>
          <label className="form-label"><strong>Output:</strong></label>
          <pre className="bg-secondary p-3 rounded" style={{ minHeight: '100px' }}>
            {output || "Output will appear here after compilation"}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default EditorPage;
