const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const ACTIONS = require("./Actions");
const cors = require("cors");
const axios = require("axios");
const mongoose = require("mongoose");
const Project = require("./models/Project");
const server = http.createServer(app);
require("dotenv").config();

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/live-syntax';
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

const languageConfig = {
  python3: { extension: 'py' },
  java: { extension: 'java' },
  cpp: { extension: 'cpp' },
  c: { extension: 'c' },
};

// Enable CORS
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5002",
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const userSocketMap = {};
const roomHosts = {}; // Track the host (first user) of each room
const pendingJoinRequests = {}; // Track users waiting for approval
const roomFileStructures = {}; // Track file structure for each room
const roomFileContents = {}; // Track file contents for each room
const fileVersions = {}; // { roomId: { filePath: number } } — per-file monotonic version
const processedOps = {}; // { roomId: Map<opId, newVersion> } — dedup with FIFO eviction
const MAX_PROCESSED_OPS = 1000;

// Helper function to get item at path in file structure
const getItemAtPath = (structure, path) => {
  const parts = path.split('/').filter(p => p && p !== 'root');
  let current = structure;
  
  for (const part of parts) {
    if (!current.children || !current.children[part]) {
      return null;
    }
    current = current.children[part];
  }
  return current;
};

// Helper function to set item at path in file structure
const setItemAtPath = (structure, path, item) => {
  const parts = path.split('/').filter(p => p && p !== 'root');
  let current = structure;
  
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current.children[parts[i]]) {
      current.children[parts[i]] = { name: parts[i], type: 'folder', children: {} };
    }
    current = current.children[parts[i]];
  }
  
  if (parts.length > 0) {
    const lastName = parts[parts.length - 1];
    current.children[lastName] = item;
  }
};

// Helper function to delete item at path in file structure
const deleteItemAtPath = (structure, path) => {
  const parts = path.split('/').filter(p => p && p !== 'root');
  let current = structure;
  
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current.children[parts[i]]) return;
    current = current.children[parts[i]];
  }
  
  if (parts.length > 0) {
    const lastName = parts[parts.length - 1];
    delete current.children[lastName];
  }
};

// Helper function to rename item at path (BUG 12 fix: always re-key)
const renameItemAtPath = (structure, oldPath, newPath) => {
  const item = getItemAtPath(structure, oldPath);
  if (!item) return;
  
  const newName = newPath.split('/').pop();
  item.name = newName;
  
  // Always delete old key and insert new key (even same parent dir)
  deleteItemAtPath(structure, oldPath);
  setItemAtPath(structure, newPath, item);
};

const getAllConnectedClients = (roomId) => {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => {
      return {
        socketId,
        username: userSocketMap[socketId],
        isHost: roomHosts[roomId] === socketId, // Check if this user is the host
      };
    }
  );
};

console.log("Allowed origins for CORS/socket.io:", allowedOrigins);
console.log("FRONTEND_URL env:", process.env.FRONTEND_URL);

io.engine.on("connection_error", (err) => {
  console.error("Engine connection error:", err.message, {
    details: err,
    origin: err.req && err.req.headers && err.req.headers.origin,
  });
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id, "handshake origin:", socket.handshake.headers.origin);
  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;

    // Check if room exists by checking if there's a host AND the host is still connected
    const currentHost = roomHosts[roomId];
    const hostSocket = currentHost ? io.sockets.sockets.get(currentHost) : null;
    const roomHasActiveHost = currentHost && hostSocket;

    // If room doesn't exist or host is not connected, this user becomes the host and joins directly
    if (!roomHasActiveHost) {
      // Set as host immediately to prevent race conditions
      roomHosts[roomId] = socket.id;
      socket.join(roomId);
      const clients = getAllConnectedClients(roomId);
      // notify that new user has joined
      clients.forEach(({ socketId }) => {
        io.to(socketId).emit(ACTIONS.JOINED, {
          clients,
          username,
          socketId: socket.id,
        });
      });
    } else {
      // Room exists with a host - send join request to host
      if (!pendingJoinRequests[roomId]) {
        pendingJoinRequests[roomId] = [];
      }

      // Check if this user is already in pending requests (avoid duplicates)
      const alreadyPending = pendingJoinRequests[roomId].some(
        req => req.socketId === socket.id
      );

      if (!alreadyPending) {
        pendingJoinRequests[roomId].push({ socketId: socket.id, username });

        // Notify the user they're waiting for approval
        io.to(socket.id).emit(ACTIONS.WAITING_FOR_APPROVAL);

        // Notify the host about the join request
        io.to(roomHosts[roomId]).emit(ACTIONS.JOIN_REQUEST, {
          socketId: socket.id,
          username,
          roomId,
        });
      }
    }
  });

  // Handle host's approval of join request
  socket.on(ACTIONS.APPROVE_JOIN, ({ socketId, roomId }) => {
    // Verify the requester is the host
    if (roomHosts[roomId] !== socket.id) return;

    // Remove from pending requests
    if (pendingJoinRequests[roomId]) {
      pendingJoinRequests[roomId] = pendingJoinRequests[roomId].filter(
        (req) => req.socketId !== socketId
      );
    }

    // Get the socket and make them join
    const joiningSocket = io.sockets.sockets.get(socketId);
    if (joiningSocket) {
      joiningSocket.join(roomId);
      const clients = getAllConnectedClients(roomId);
      const username = userSocketMap[socketId];
      
      // Notify all clients including the newly joined user
      clients.forEach(({ socketId: clientSocketId }) => {
        io.to(clientSocketId).emit(ACTIONS.JOINED, {
          clients,
          username,
          socketId,
        });
      });
    }
  });

  // Handle host's rejection of join request
  socket.on(ACTIONS.REJECT_JOIN, ({ socketId, roomId }) => {
    // Verify the requester is the host
    if (roomHosts[roomId] !== socket.id) return;

    // Remove from pending requests
    if (pendingJoinRequests[roomId]) {
      pendingJoinRequests[roomId] = pendingJoinRequests[roomId].filter(
        (req) => req.socketId !== socketId
      );
    }

    // Notify the rejected user
    io.to(socketId).emit(ACTIONS.JOIN_REJECTED, { roomId });
  });

  // ── CODE_CHANGE handler (BUGs 1,8,9,10,11 + precision fixes 2,4,5,6) ──
  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code, change, filePath, version, opId }, ackCallback) => {
    // BUG 8: Room membership check
    if (!socket.rooms.has(roomId)) {
      socket.emit(ACTIONS.STALE_EVENT_REJECTED, { reason: 'Not in room', filePath });
      if (typeof ackCallback === 'function') ackCallback({ status: 'rejected' });
      return;
    }

    // Initialize structures if missing
    if (!roomFileContents[roomId]) roomFileContents[roomId] = {};
    if (!fileVersions[roomId]) fileVersions[roomId] = {};
    if (!processedOps[roomId]) processedOps[roomId] = new Map();
    if (fileVersions[roomId][filePath] === undefined) fileVersions[roomId][filePath] = 0;

    // FIX 5: Server-side dedup — if already processed, return cached ACK
    if (opId && processedOps[roomId].has(opId)) {
      const cachedVersion = processedOps[roomId].get(opId);
      if (typeof ackCallback === 'function') ackCallback({ status: 'ok', newVersion: cachedVersion });
      return;
    }

    // FIX 2: Version validation — client must send serverVersion + 1
    const serverVersion = fileVersions[roomId][filePath];
    if (version !== undefined && version !== serverVersion + 1) {
      // Version mismatch — emit conflict with authoritative state
      socket.emit(ACTIONS.CODE_CONFLICT, {
        filePath,
        expectedVersion: serverVersion + 1,
        serverVersion,
        latestContent: roomFileContents[roomId][filePath] || '',
      });
      if (typeof ackCallback === 'function') ackCallback({ status: 'conflict', serverVersion });
      return;
    }

    // FIX 4: ALWAYS update in-memory (memory is source of truth)
    const newVersion = serverVersion + 1;
    fileVersions[roomId][filePath] = newVersion;
    roomFileContents[roomId][filePath] = code;

    // FIX 5: Record in dedup map
    if (opId) {
      processedOps[roomId].set(opId, newVersion);
      if (processedOps[roomId].size > MAX_PROCESSED_OPS) {
        const firstKey = processedOps[roomId].keys().next().value;
        processedOps[roomId].delete(firstKey);
      }
    }

    // FIX 6: Broadcast change delta + full code to room (excluding sender)
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, {
      code, change, filePath, version: newVersion,
    });

    // ACK the sender
    if (typeof ackCallback === 'function') {
      ackCallback({ status: 'ok', newVersion });
    }

    // FIX 4: Persist to DB asynchronously (best-effort, memory already updated)
    Project.findOneAndUpdate(
      { roomId },
      { fileContents: roomFileContents[roomId], updatedAt: new Date() },
      { upsert: true }
    ).catch(async (err) => {
      console.error('DB save failed, retrying once:', err.message);
      try {
        await Project.findOneAndUpdate(
          { roomId },
          { fileContents: roomFileContents[roomId], updatedAt: new Date() },
          { upsert: true }
        );
      } catch (err2) {
        console.error('DB save retry failed:', err2.message);
        io.to(socket.id).emit(ACTIONS.SAVE_ERROR, { filePath, error: err2.message });
      }
    });
    // NOTE: FILE_STRUCTURE_UPDATE is NOT broadcast here (BUG 11 fix)
  });

  // ── REQUEST_FILE_SYNC handler (BUGs 3, 5) ──
  socket.on(ACTIONS.REQUEST_FILE_SYNC, ({ roomId, filePath, seq }) => {
    const content = (roomFileContents[roomId] && roomFileContents[roomId][filePath]) || '';
    const version = (fileVersions[roomId] && fileVersions[roomId][filePath]) || 0;
    socket.emit(ACTIONS.FILE_SYNC_RESPONSE, { filePath, content, version, seq });
  });

  // ── RECONNECT_SYNC handler (BUG 6) ──
  socket.on(ACTIONS.RECONNECT_SYNC_START, ({ roomId, filePath }) => {
    const content = (roomFileContents[roomId] && roomFileContents[roomId][filePath]) || '';
    const version = (fileVersions[roomId] && fileVersions[roomId][filePath]) || 0;
    socket.emit(ACTIONS.RECONNECT_SYNC_DONE, { filePath, content, version });
  });

  // sync cursor positions (BUG 4: add filePath passthrough)
  socket.on(ACTIONS.CURSOR_CHANGE, ({ roomId, cursor, selection, filePath }) => {
    socket.in(roomId).emit(ACTIONS.CURSOR_CHANGE, {
      socketId: socket.id,
      username: userSocketMap[socket.id],
      cursor,
      selection,
      filePath,
    });
  });
  
  // File structure sync - when new user joins, send them the file structure
  socket.on(ACTIONS.FILE_STRUCTURE_SYNC, async ({ fileStructure, fileContents, socketId }) => {
    // Get the room ID
    const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
    
    console.log("📁 FILE_STRUCTURE_SYNC received:", { roomId, files: Object.keys(fileContents || {}) });
    
    try {
      // Check if project exists in MongoDB
      const existingProject = await Project.findOne({ roomId });
      
      if (existingProject) {
        // Project exists - load from MongoDB (source of truth)
        console.log("✅ Project found in MongoDB - loading existing data:", { roomId, files: Object.keys(existingProject.fileContents || {}) });
        roomFileStructures[roomId] = existingProject.fileStructure;
        roomFileContents[roomId] = existingProject.fileContents || {};
      } else {
        // Project doesn't exist - this is the first user, save their structure
        roomFileStructures[roomId] = fileStructure;
        roomFileContents[roomId] = fileContents || {};
        
        // Save to MongoDB
        await Project.create({
          roomId,
          fileStructure,
          fileContents: fileContents || {},
          projectName: `Project-${roomId.slice(0, 8)}`,
        });
        console.log("✅ New project created in MongoDB:", { roomId, files: Object.keys(fileContents || {}) });
      }
    } catch (err) {
      console.error("Error in FILE_STRUCTURE_SYNC:", err);
    }

    // Initialize fileVersions for this room if not present
    if (!fileVersions[roomId]) fileVersions[roomId] = {};
    const contents = roomFileContents[roomId] || {};
    for (const fp of Object.keys(contents)) {
      if (fileVersions[roomId][fp] === undefined) fileVersions[roomId][fp] = 0;
    }
    
    // Send the current server state to the joining user
    const filesToSend = roomFileContents[roomId] || {};
    
    io.to(socketId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
      fileStructure: roomFileStructures[roomId],
      fileContents: filesToSend,
    });
    
    // Also broadcast to existing users to keep them in sync on join
    socket.in(roomId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
      fileStructure: roomFileStructures[roomId],
      fileContents: filesToSend,
    });
  });
  
  // File operations - broadcast to all users in room
  socket.on(ACTIONS.FILE_CREATE, ({ roomId, path, fileName }) => {
    console.log("📄 FILE_CREATE received:", { roomId, path, fileName });
    
    // Initialize room's file contents if not already done
    if (!roomFileContents[roomId]) {
      roomFileContents[roomId] = {};
    }
    
    // Update server-side file structure
    if (roomFileStructures[roomId]) {
      setItemAtPath(roomFileStructures[roomId], path, {
        name: fileName,
        type: 'file',
        content: '',
      });
      roomFileContents[roomId][path] = '';
      
      // Save to MongoDB immediately
      Project.findOneAndUpdate(
        { roomId },
        {
          fileStructure: roomFileStructures[roomId],
          fileContents: roomFileContents[roomId],
          updatedAt: new Date(),
        },
        { upsert: true }
      ).catch(err => console.error("Error saving FILE_CREATE to MongoDB:", err));
      
      console.log("💾 File saved to MongoDB:", { roomId, path });
    }
    
    // Broadcast complete updated structure to all users in room
    io.to(roomId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
      fileStructure: roomFileStructures[roomId],
      fileContents: roomFileContents[roomId],
    });
    console.log("📤 FILE_STRUCTURE_UPDATE broadcasted after file creation:", { roomId, path });
  });
  
  socket.on(ACTIONS.FOLDER_CREATE, ({ roomId, path, folderName }) => {
    // Initialize room's file contents if not already done
    if (!roomFileContents[roomId]) {
      roomFileContents[roomId] = {};
    }
    
    // Update server-side file structure
    if (roomFileStructures[roomId]) {
      setItemAtPath(roomFileStructures[roomId], path, {
        name: folderName,
        type: 'folder',
        children: {},
      });
    }
    
    // Broadcast complete updated structure to all users in room
    io.to(roomId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
      fileStructure: roomFileStructures[roomId],
      fileContents: roomFileContents[roomId],
    });
  });
  
  socket.on(ACTIONS.FILE_DELETE, ({ roomId, path }) => {
    // Initialize room's file contents if not already done
    if (!roomFileContents[roomId]) {
      roomFileContents[roomId] = {};
    }
    
    // Update server-side file structure
    if (roomFileStructures[roomId]) {
      deleteItemAtPath(roomFileStructures[roomId], path);
      delete roomFileContents[roomId][path];
    }
    
    // Broadcast complete updated structure to all users in room
    io.to(roomId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
      fileStructure: roomFileStructures[roomId],
      fileContents: roomFileContents[roomId],
    });
  });
  
  socket.on(ACTIONS.FILE_RENAME, ({ roomId, oldPath, newPath }) => {
    // Initialize room's file contents if not already done
    if (!roomFileContents[roomId]) {
      roomFileContents[roomId] = {};
    }
    
    // Update server-side file structure
    if (roomFileStructures[roomId]) {
      renameItemAtPath(roomFileStructures[roomId], oldPath, newPath);
      if (roomFileContents[roomId][oldPath]) {
        roomFileContents[roomId][newPath] = roomFileContents[roomId][oldPath];
        delete roomFileContents[roomId][oldPath];
      }
    }
    
    // Broadcast complete updated structure to all users in room
    io.to(roomId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
      fileStructure: roomFileStructures[roomId],
      fileContents: roomFileContents[roomId],
    });
  });
  
  // when new user join the room all the code which are there are also shows on that persons editor
  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  // Voice call signaling handlers
  socket.on(ACTIONS.JOIN_CALL, ({ roomId }) => {
    // Notify all other users in the room that this user joined the call
    socket.to(roomId).emit(ACTIONS.CALL_USER_JOINED, {
      socketId: socket.id,
      username: userSocketMap[socket.id],
    });
    console.log(`${userSocketMap[socket.id]} joined call in room ${roomId}`);
  });

  socket.on(ACTIONS.LEAVE_CALL, ({ roomId }) => {
    // Notify all other users in the room that this user left the call
    socket.to(roomId).emit(ACTIONS.CALL_USER_LEFT, {
      socketId: socket.id,
      username: userSocketMap[socket.id],
    });
    console.log(`${userSocketMap[socket.id]} left call in room ${roomId}`);
  });

  socket.on(ACTIONS.WEBRTC_OFFER, ({ offer, to, roomId }) => {
    // Forward WebRTC offer to specific peer
    io.to(to).emit(ACTIONS.WEBRTC_OFFER, {
      offer,
      from: socket.id,
      username: userSocketMap[socket.id],
    });
  });

  socket.on(ACTIONS.WEBRTC_ANSWER, ({ answer, to }) => {
    // Forward WebRTC answer to specific peer
    io.to(to).emit(ACTIONS.WEBRTC_ANSWER, {
      answer,
      from: socket.id,
    });
  });

  socket.on(ACTIONS.WEBRTC_ICE_CANDIDATE, ({ candidate, to }) => {
    // Forward ICE candidate to specific peer
    io.to(to).emit(ACTIONS.WEBRTC_ICE_CANDIDATE, {
      candidate,
      from: socket.id,
    });
  });

  // leave room
  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    const leavingUsername = userSocketMap[socket.id];
    const leavingSocketId = socket.id;
    
    // leave all the room
    rooms.forEach((roomId) => {
      // Skip the socket's own room (every socket is in a room with its own ID)
      if (roomId === socket.id) return;
      
      // If the host leaves
      if (roomHosts[roomId] === socket.id) {
        const remainingClients = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
          .filter(sid => sid !== socket.id)
          .map((socketId) => ({
            socketId,
            username: userSocketMap[socketId],
            isHost: false, // Will be updated for new host
          }));
        
        if (remainingClients.length === 0) {
          delete roomHosts[roomId];
          delete pendingJoinRequests[roomId];
          delete roomFileStructures[roomId];
          delete roomFileContents[roomId];
        } else {
          // Transfer host to the next person (first remaining client)
          const newHost = remainingClients[0];
          roomHosts[roomId] = newHost.socketId;
          
          // Update isHost flag for new host
          const updatedClients = remainingClients.map(client => ({
            ...client,
            isHost: client.socketId === newHost.socketId,
          }));
          
          // Notify all remaining clients about the host change and updated client list
          remainingClients.forEach(({ socketId: clientSocketId }) => {
            io.to(clientSocketId).emit(ACTIONS.HOST_CHANGED, {
              newHostSocketId: newHost.socketId,
              newHostUsername: newHost.username,
              clients: updatedClients,
            });
          });

          // BUG 17: Forward pending join requests to new host
          if (pendingJoinRequests[roomId] && pendingJoinRequests[roomId].length > 0) {
            pendingJoinRequests[roomId].forEach(({ socketId: reqSid, username: reqUser }) => {
              io.to(newHost.socketId).emit(ACTIONS.JOIN_REQUEST, {
                socketId: reqSid,
                username: reqUser,
                roomId,
              });
            });
          }
        }
      } else {
        // If a non-host leaves, just notify others
        socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
          socketId: leavingSocketId,
          username: leavingUsername,
        });
      }
      
      // Remove from pending requests if disconnecting while waiting
      if (pendingJoinRequests[roomId]) {
        pendingJoinRequests[roomId] = pendingJoinRequests[roomId].filter(
          (req) => req.socketId !== socket.id
        );
      }
    });

    delete userSocketMap[socket.id];
    socket.leave();
  });
});

app.get("/health", async (req, res)=>{ res.json({
     status:"running",
    });
  });

// Save project to MongoDB
app.post("/save-project", async (req, res) => {
  try {
    const { roomId, fileStructure, projectName } = req.body;

    if (!roomId) {
      return res.status(400).json({ error: 'roomId is required' });
    }

    // Use the in-memory fileContents (already synced to MongoDB on every change)
    const fileContents = roomFileContents[roomId] || {};

    const project = await Project.findOneAndUpdate(
      { roomId },
      {
        roomId,
        fileStructure,
        fileContents,
        projectName: projectName || 'Untitled Project',
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: 'Project saved successfully',
      project,
    });
  } catch (err) {
    console.error('Error saving project:', err);
    res.status(500).json({ 
      error: 'Failed to save project',
      details: err.message 
    });
  }
});

// Load project from MongoDB
app.get("/load-project/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;

    const project = await Project.findOne({ roomId });

    if (!project) {
      return res.status(404).json({ 
        error: 'Project not found',
        message: 'No saved project found for this room ID'
      });
    }

    res.json({
      success: true,
      fileStructure: project.fileStructure,
      fileContents: project.fileContents,
      projectName: project.projectName,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  } catch (err) {
    console.error('Error loading project:', err);
    res.status(500).json({ 
      error: 'Failed to load project',
      details: err.message 
    });
  }
});

// Delete project from MongoDB
app.delete("/delete-project/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;

    // Delete from MongoDB
    const result = await Project.deleteOne({ roomId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        error: 'Project not found'
      });
    }

    res.json({
      success: true,
      message: 'Project deleted successfully',
    });
  } catch (err) {
    console.error('Error deleting project:', err);
    res.status(500).json({ 
      error: 'Failed to delete project',
      details: err.message 
    });
  }
});

app.post("/compile", async (req, res) => {
  const { code, language, input = "" } = req.body;

  if (!languageConfig[language]) {
    return res.status(400).json({ error: `Unsupported language: ${language}` });
  }

  const clientId = process.env.JDOODLE_CLIENT_ID;
  const clientSecret = process.env.JDOODLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "JDoodle API credentials not configured in server/.env" });
  }

  try {
    // JDoodle language mapping
    const jdoodleLanguages = {
      python3: { language: "python3", versionIndex: "4" },
      java: { language: "java", versionIndex: "4" },
      cpp: { language: "cpp", versionIndex: "5" },
      c: { language: "c", versionIndex: "5" }
    };
    
    const jdoodleConfig = jdoodleLanguages[language];
    if (!jdoodleConfig) {
      return res.status(400).json({ error: `Unsupported language for compilation: ${language}` });
    }
    
    const response = await axios.post(`https://api.jdoodle.com/v1/execute`, {
      clientId: clientId,
      clientSecret: clientSecret,
      script: code,
      language: jdoodleConfig.language,
      versionIndex: jdoodleConfig.versionIndex,
      stdin: input
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const result = response.data;
    
    res.json({
      output: result.output || "",
      error: result.error || null,
      memory: result.memory,
      cpuTime: result.cpuTime
    });

  } catch (error) {
    console.error("Compilation error:", error);
    res.status(500).json({ 
      error: "Failed to compile code",
      details: error.response?.data?.error || error.message
    });
  }
});

// AI assistant endpoint - uses Groq API (free and fast)
app.post("/ai", async (req, res) => {
  const { prompt = "", code = "", language = "" } = req.body;
  const apiKey = (process.env.GROQ_API_KEY || '').trim();

  if (!apiKey || apiKey === 'your_groq_api_key_here') {
    return res.status(500).json({ 
      error: "Groq API key not configured. Get a free key from https://console.groq.com and add it to server/.env as GROQ_API_KEY" 
    });
  }

  // Build the message with context
  const systemMessage = `You are a concise coding assistant. When analyzing code:

Format your response EXACTLY like this:
Corrected Code:
[Show only the fixed code here]

Do not add any explanations, comments, or error descriptions. Only output "Corrected Code:" followed by the code on the next line.`;
  
  const userMessage = code 
    ? `${prompt}\n\nLanguage: ${language}\nCode:\n${code}\n\nProvide only the corrected code.`
    : prompt;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 1024
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content || "No response generated";
    return res.json({ reply });
    
  } catch (err) {
    const errorMsg = err?.response?.data?.error?.message || err.message || "AI request failed";
    return res.status(500).json({ 
      error: errorMsg
    });
  }
});

const PORT = process.env.PORT || 5002;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
