# LiveSyntax Project - Comprehensive Technical Report

## Table of Contents
1. [Project Overview](#project-overview)
2. [Calling System (WebRTC)](#calling-system-webrtc)
3. [Multiple Filing System](#multiple-filing-system)
4. [Backend System](#backend-system)
5. [Communication Architecture](#communication-architecture)
6. [Data Flow](#data-flow)
7. [Technologies Used](#technologies-used)

---

## Project Overview

**LiveSyntax** is a real-time collaborative code editor platform that allows multiple users to:
- Edit code simultaneously in shared rooms
- Make voice calls with peers using WebRTC
- Manage files and folders in a tree structure
- Compile and execute code using Piston API
- Get AI-assisted code corrections via Groq API

### Key Features:
- 🔴 **Real-time Code Collaboration** - Multiple cursors, selections, and live code sync
- 🎤 **Voice Calling** - WebRTC-based peer-to-peer voice communication
- 📁 **File Management** - Create, delete, rename files and folders
- 🗂️ **Tab System** - Open multiple files simultaneously
- 🎨 **Syntax Highlighting** - Language-specific highlighting with CodeMirror
- 🤖 **AI Assistant** - Code correction and suggestions via Groq
- ▶️ **Live Compilation** - Run code on Piston servers

### Project Structure:
```
LiveSyntax/
├── client/                          # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── Editor.js           # CodeMirror editor
│   │   │   ├── EditorPage.js       # Main container (state management)
│   │   │   ├── FileExplorer.js     # File tree component
│   │   │   ├── FileTabs.js         # Tab bar for open files
│   │   │   ├── Home.js             # Home page
│   │   │   └── Client.js           # Client list & connection UI
│   │   ├── Socket.js               # Socket.IO client initialization
│   │   ├── WebRTCManager.js        # WebRTC call management
│   │   └── Actions.js              # Socket event constants
│   └── package.json
├── server/                          # Node.js/Express backend
│   ├── index.js                    # Main server & Socket.IO handlers
│   ├── fileManager.js              # File system operations
│   ├── models/
│   │   └── Project.js              # MongoDB Project schema
│   ├── Actions.js                  # Socket event constants
│   └── package.json
└── README.md
```

---

## Calling System (WebRTC)

### Overview
The calling system enables peer-to-peer voice communication using WebRTC (Web Real-Time Communication). It's built on top of the Socket.IO signaling layer.

### Architecture

#### Client-Side: `WebRTCManager.js`

**Class Structure:**
```javascript
class WebRTCManager {
  constructor(socketRef, roomId, username)
  - socketRef: Reference to Socket.IO connection
  - roomId: The collaboration room
  - username: User's display name
  - localStream: User's microphone audio stream
  - peerConnections: Map of socketId -> RTCPeerConnection
  - remoteAudioElements: Map of socketId -> Audio HTML elements
  - isMuted: Mute state
  - isInCall: Call active state
}
```

#### Key Methods:

1. **initializeLocalStream()**
   - Requests microphone access from the user
   - Configures audio settings:
     - Echo Cancellation: Removes feedback noise
     - Noise Suppression: Reduces background noise
     - Auto Gain Control: Normalizes volume levels
   - Returns: Boolean (success/failure)

2. **joinCall(existingUsers = [])**
   - Initializes local audio stream
   - Sets up WebRTC signaling listeners
   - Emits JOIN_CALL to server
   - Creates peer connections with all existing call participants
   - Uses tie-breaker logic: Only the peer with lexicographically smaller socket ID creates the offer
   - Prevents both peers from sending offers simultaneously

3. **createPeerConnection(socketId, shouldCreateOffer)**
   ```
   Steps:
   1. Create new RTCPeerConnection with STUN servers
   2. Add local audio tracks to the connection
   3. Setup event listeners:
      - ontrack: Handle incoming remote audio stream
      - onicecandidate: Send ICE candidates to peer
      - onconnectionstatechange: Monitor connection health
   4. If initiator: Call createAndSendOffer()
   ```

4. **createAndSendOffer(socketId)**
   - Creates SDP (Session Description Protocol) offer
   - Sets it as local description
   - Emits WEBRTC_OFFER to peer via Socket.IO

5. **leaveCall()**
   - Notifies server with LEAVE_CALL event
   - Closes all peer connections
   - Stops microphone tracks
   - Cleans up audio elements
   - Removes signaling listeners

6. **toggleMute()**
   - Enables/disables audio track
   - Returns current mute state

#### Signaling Listeners (setupSignalingListeners):

```
Event Flow for Incoming Call:

┌─────────────────────────────────────────────────────┐
│                 New User Joins Call                 │
└──────────────────────┬────────────────────────────┘
                       │
                       ├─→ Server notifies existing peers
                       │
                       └─→ CALL_USER_JOINED event received
                           ├─→ createPeerConnection(newUserSocketId, true)
                           └─→ Send offer to new user
```

**Signaling Event Handlers:**

1. **CALL_USER_JOINED** - New peer joined the call
   - Creates peer connection with new user
   - Initiates WebRTC offer if conditions met

2. **WEBRTC_OFFER** - Incoming offer from peer
   - Creates peer connection if needed
   - Sets remote description from offer
   - Creates and sends answer

3. **WEBRTC_ANSWER** - Response from peer
   - Sets remote description from answer

4. **WEBRTC_ICE_CANDIDATE** - Network path candidate
   - Adds ICE candidate to peer connection
   - Enables NAT traversal

5. **CALL_USER_LEFT** - Peer left the call
   - Closes peer connection
   - Stops receiving audio from that peer

#### ICE Servers (STUN):
```javascript
ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ]
}
```
- Used for NAT traversal
- Helps find public IP addresses
- Allows peers to discover each other across firewalls

### Server-Side Call Handling: `index.js`

**Socket Events for Calls:**

```javascript
// When user joins call
socket.on(ACTIONS.JOIN_CALL, ({ roomId }) => {
  // Notify all other users in room about new caller
  socket.to(roomId).emit(ACTIONS.CALL_USER_JOINED, {
    socketId: socket.id,
    username: userSocketMap[socket.id]
  });
});

// When user leaves call
socket.on(ACTIONS.LEAVE_CALL, ({ roomId }) => {
  // Notify others that user left
  socket.to(roomId).emit(ACTIONS.CALL_USER_LEFT, {
    socketId: socket.id,
    username: userSocketMap[socket.id]
  });
});

// Relay WebRTC offer to target peer
socket.on(ACTIONS.WEBRTC_OFFER, ({ offer, to, roomId }) => {
  io.to(to).emit(ACTIONS.WEBRTC_OFFER, {
    offer,
    from: socket.id,
    username: userSocketMap[socket.id]
  });
});

// Relay WebRTC answer to target peer
socket.on(ACTIONS.WEBRTC_ANSWER, ({ answer, to }) => {
  io.to(to).emit(ACTIONS.WEBRTC_ANSWER, {
    answer,
    from: socket.id
  });
});

// Relay ICE candidate for NAT traversal
socket.on(ACTIONS.WEBRTC_ICE_CANDIDATE, ({ candidate, to }) => {
  io.to(to).emit(ACTIONS.WEBRTC_ICE_CANDIDATE, {
    candidate,
    from: socket.id
  });
});
```

### Call Flow Sequence:

```
User A                    Server                    User B
  │                         │                         │
  ├─ JOIN_CALL ────────────>│                         │
  │                         ├─ CALL_USER_JOINED ───>│
  │                         │                         │
  │                         │<─ JOIN_CALL ──────────┤
  │<─ CALL_USER_JOINED ─────┤                         │
  │                         │                         │
  ├─ Create Offer ─────────────────────────────────>│
  │   (WebRTC negotiation)                            │
  │                                                   │
  ├─ WEBRTC_OFFER ─────────>│                         │
  │                         ├─ WEBRTC_OFFER ───────>│
  │                         │                         │
  │                         │<─ WEBRTC_ANSWER ──────┤
  │<─ WEBRTC_ANSWER ───────┤                         │
  │                         │                         │
  ├─ ICE Candidates ───────>│─────────────────────>│
  │ (Network discovery)     │                       │
  │                         │                         │
  │◄══════ AUDIO STREAM ═════════════════════════════►│
  │     (P2P Connection Established)                   │
```

---

## Multiple Filing System

### Overview
LiveSyntax supports a hierarchical file structure similar to VS Code, allowing users to:
- Create files and folders
- Organize code in directories
- Switch between multiple open files using tabs
- Synchronize file changes across all collaborators

### File System Architecture

#### Client-Side State Management: `EditorPage.js`

**Core State Variables:**

```javascript
const [fileStructure, setFileStructure] = useState({
  name: "root",
  type: "folder",
  children: {
    "index.js": {
      name: "index.js",
      type: "file",
      content: "// Welcome to Live Syntax!"
    }
  }
});

const [openFiles, setOpenFiles] = useState(["/root/index.js"]);
const [activeFile, setActiveFile] = useState("/root/index.js");
const [fileContents, setFileContents] = useState({
  "/root/index.js": "// Welcome..."
});
```

**File Path Convention:**
- All paths start with `/root/`
- Example: `/root/folder/subfolder/file.js`
- Used consistently across client and server

#### File Structure Tree Format:

```javascript
{
  name: "root",
  type: "folder",
  children: {
    "index.js": {
      name: "index.js",
      type: "file",
      content: ""
    },
    "utils": {
      name: "utils",
      type: "folder",
      children: {
        "helpers.js": {
          name: "helpers.js",
          type: "file",
          content: ""
        },
        "constants.js": {
          name: "constants.js",
          type: "file",
          content: ""
        }
      }
    }
  }
}
```

### File Operations

#### 1. **File Creation**

**Client Action (FileExplorer.js):**
```javascript
// User creates new file
→ socket.emit(ACTIONS.FILE_CREATE, {
    roomId,
    path: "/root/newFolder",
    fileName: "newFile.js"
  })
```

**Server Processing (index.js):**
```javascript
socket.on(ACTIONS.FILE_CREATE, ({ roomId, path, fileName }) => {
  if (roomFileStructures[roomId]) {
    setItemAtPath(roomFileStructures[roomId], path, {
      name: fileName,
      type: 'file',
      content: ''
    });
    roomFileContents[roomId][path] = '';
    
    // Save to disk
    fileManager.saveFile(roomId, path, '');
  }
  
  // Broadcast updated structure to ALL room users
  io.to(roomId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
    fileStructure: roomFileStructures[roomId],
    fileContents: roomFileContents[roomId]
  });
});
```

**Client Update (EditorPage.js):**
```javascript
socket.on(ACTIONS.FILE_STRUCTURE_UPDATE, ({ fileStructure, fileContents }) => {
  setFileStructure(fileStructure);
  setFileContents(prev => ({ ...prev, ...fileContents }));
});
```

#### 2. **Folder Creation**

```javascript
socket.on(ACTIONS.FOLDER_CREATE, ({ roomId, path, folderName }) => {
  setItemAtPath(roomFileStructures[roomId], path, {
    name: folderName,
    type: 'folder',
    children: {}
  });
  
  io.to(roomId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
    fileStructure: roomFileStructures[roomId],
    fileContents: roomFileContents[roomId]
  });
});
```

#### 3. **File Deletion**

```javascript
socket.on(ACTIONS.FILE_DELETE, ({ roomId, path }) => {
  deleteItemAtPath(roomFileStructures[roomId], path);
  delete roomFileContents[roomId][path];
  
  io.to(roomId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
    fileStructure: roomFileStructures[roomId],
    fileContents: roomFileContents[roomId]
  });
});
```

#### 4. **File Rename**

```javascript
socket.on(ACTIONS.FILE_RENAME, ({ roomId, oldPath, newPath }) => {
  renameItemAtPath(roomFileStructures[roomId], oldPath, newPath);
  
  // Update file contents mapping
  if (roomFileContents[roomId][oldPath]) {
    roomFileContents[roomId][newPath] = roomFileContents[roomId][oldPath];
    delete roomFileContents[roomId][oldPath];
  }
  
  io.to(roomId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
    fileStructure: roomFileStructures[roomId],
    fileContents: roomFileContents[roomId]
  });
});
```

#### 5. **Tab Switching**

**When User Switches Files:**
```
User clicks file tab
    ↓
activeFile state changes
    ↓
Editor.js loads content from fileContents[activeFile]
    ↓
Cleanup: Save previous file content to fileContents
    ↓
CodeMirror re-renders with new file content
```

#### Helper Functions: `index.js`

```javascript
// Get item at specific path in tree
getItemAtPath(structure, path) {
  const parts = path.split('/').filter(p => p && p !== 'root');
  let current = structure;
  for (const part of parts) {
    current = current.children[part];
  }
  return current;
}

// Set item at path (creates structure if needed)
setItemAtPath(structure, path, item) {
  const parts = path.split('/').filter(p => p && p !== 'root');
  let current = structure;
  
  // Create parent folders if they don't exist
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current.children[parts[i]]) {
      current.children[parts[i]] = {
        name: parts[i],
        type: 'folder',
        children: {}
      };
    }
    current = current.children[parts[i]];
  }
  
  // Set the final item
  current.children[parts[parts.length - 1]] = item;
}

// Delete item at path
deleteItemAtPath(structure, path) {
  const parts = path.split('/').filter(p => p && p !== 'root');
  let current = structure;
  
  // Navigate to parent
  for (let i = 0; i < parts.length - 1; i++) {
    current = current.children[parts[i]];
  }
  
  // Delete child
  delete current.children[parts[parts.length - 1]];
}

// Rename item (update name and move if needed)
renameItemAtPath(structure, oldPath, newPath) {
  const item = getItemAtPath(structure, oldPath);
  const newName = newPath.split('/').pop();
  item.name = newName;
  
  // If parent changed, move the item
  deleteItemAtPath(structure, oldPath);
  setItemAtPath(structure, newPath, item);
}
```

### Server-Side File Storage: `fileManager.js`

**File Persistence:**
```
Room Structure on Disk:
projects/
├── room-uuid-1/
│   ├── index.js
│   ├── utils/
│   │   ├── helpers.js
│   │   └── constants.js
│   └── config/
│       └── settings.json
├── room-uuid-2/
│   └── main.py
└── ...
```

**Key Functions:**

```javascript
// Create project directory for room
createProjectDirectory(roomId) {
  const projectPath = path.join(PROJECTS_DIR, roomId);
  fs.mkdirSync(projectPath, { recursive: true });
  return projectPath;
}

// Get full file path on disk
getFilePath(roomId, filePath) {
  // /root/folder/file.js → projects/roomId/folder/file.js
  const parts = filePath.split('/').slice(1); // Remove 'root'
  return path.join(PROJECTS_DIR, roomId, ...parts);
}

// Save file to disk
saveFile(roomId, filePath, content) {
  const fullPath = getFilePath(roomId, filePath);
  const dirName = path.dirname(fullPath);
  fs.mkdirSync(dirName, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

// Read file from disk
readFile(roomId, filePath) {
  const fullPath = getFilePath(roomId, filePath);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf-8');
  }
  return '';
}

// Get all files in project
getAllFiles(roomId) {
  const projectPath = path.join(PROJECTS_DIR, roomId);
  const fileContents = {};
  
  // Walk directory recursively
  function walkDir(dir, baseDir = '') {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        walkDir(fullPath, baseDir + '/' + file);
      } else {
        const relativePath = path.relative(projectPath, fullPath);
        const fileKey = '/root/' + relativePath.replace(/\\/g, '/');
        fileContents[fileKey] = fs.readFileSync(fullPath, 'utf-8');
      }
    }
  }
  
  walkDir(projectPath);
  return fileContents;
}

// Delete project
deleteProject(roomId) {
  const projectPath = path.join(PROJECTS_DIR, roomId);
  fs.rmSync(projectPath, { recursive: true, force: true });
}
```

### Code Change Synchronization

**When User Types:**
```javascript
// Editor.js detects change
onChange(newCode) {
  socket.emit(ACTIONS.CODE_CHANGE, {
    roomId,
    code: newCode,
    filePath: activeFile
  });
}
```

**Server Broadcasts Change:**
```javascript
socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code, filePath }) => {
  // Update in-memory file content
  roomFileContents[roomId][filePath] = code;
  
  // Save to disk immediately
  fileManager.saveFile(roomId, filePath, code);
  
  // Broadcast to all other users
  socket.in(roomId).emit(ACTIONS.CODE_CHANGE, {
    code,
    filePath
  });
});
```

**Other Clients Receive Update:**
```javascript
socket.on(ACTIONS.CODE_CHANGE, ({ code, filePath }) => {
  setFileContents(prev => ({
    ...prev,
    [filePath]: code
  }));
  
  // If it's the active file, Editor.js re-renders
  // If it's inactive, content is stored for later retrieval
});
```

### File Sync on User Join

**When New User Joins Room:**
```
New User Connects
    ↓
Emits FILE_STRUCTURE_SYNC with local file state
    ↓
Server checks if structure already exists
    ├─ If NOT (first user): Store structure + contents
    │                       Initialize project on disk
    └─ If EXISTS: Send current server state to new user
    ↓
Server emits FILE_STRUCTURE_UPDATE
    ↓
New User's EditorPage receives and merges fileContents
    ↓
File tree and editor now in sync with room state
```

---

## Backend System

### Server Architecture

#### Main Server: `server/index.js`

**Framework Stack:**
- Express.js - HTTP server
- Socket.IO - Real-time bidirectional communication
- Mongoose - MongoDB ODM
- Cors - Cross-origin resource sharing

**Server Configuration:**
```javascript
const express = require('express');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

// MongoDB Connection
mongoose.connect(MONGO_URI);

// CORS Configuration
const allowedOrigins = [
  'http://localhost:3000',       // Local development
  'http://localhost:5002',       // Local backend
  process.env.FRONTEND_URL,      // Production frontend
];

const io = new Server(server, {
  cors: { origin: allowedOrigins },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});
```

### Core Data Structures

#### In-Memory Room State:

```javascript
// Maps user socket ID to username
const userSocketMap = {
  'socket-id-1': 'Alice',
  'socket-id-2': 'Bob'
};

// Tracks room host (first user who created room)
const roomHosts = {
  'room-uuid': 'socket-id-1'  // Alice is the host
};

// Pending join requests (for approval system)
const pendingJoinRequests = {
  'room-uuid': [
    { socketId: 'socket-id-3', username: 'Charlie' }
  ]
};

// File structure for each room
const roomFileStructures = {
  'room-uuid': {
    name: 'root',
    type: 'folder',
    children: { ... }
  }
};

// File contents cached in memory
const roomFileContents = {
  'room-uuid': {
    '/root/index.js': 'console.log("hello")',
    '/root/utils/helpers.js': 'function helper() {...}'
  }
};
```

#### MongoDB Project Model: `models/Project.js`

```javascript
{
  roomId: String (unique, indexed),
  fileStructure: Object (hierarchical tree),
  fileContents: Object (file path -> content),
  projectName: String (default: "Untitled Project"),
  createdAt: Date,
  updatedAt: Date,
  __v: Number (version)
}
```

**Purpose:**
- Persistent storage of projects
- Retrieves projects on server restart
- Archival of completed sessions

### Room Management

#### User Join Flow:

```
1. User Connects to Socket
   socket.on(ACTIONS.JOIN, { roomId, username })
   
2. Check if Room Exists
   - Room exists = Has active host connected
   - New room = No host or host disconnected

3. If NEW ROOM:
   ├─ Make this user the FIRST HOST
   ├─ Add to socket room directly
   └─ Emit JOINED event to all clients
   
4. If EXISTING ROOM:
   ├─ Add to pendingJoinRequests
   ├─ Emit WAITING_FOR_APPROVAL to user
   └─ Notify host: ACTIONS.JOIN_REQUEST
   
5. Host Decision:
   ├─ APPROVE: Add user to room, emit JOINED
   └─ REJECT: Emit JOIN_REJECTED, kick out
```

**Code Implementation:**
```javascript
socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
  userSocketMap[socket.id] = username;
  
  const currentHost = roomHosts[roomId];
  const hostSocket = currentHost ? io.sockets.sockets.get(currentHost) : null;
  const roomHasActiveHost = currentHost && hostSocket;
  
  if (!roomHasActiveHost) {
    // New room - user becomes host
    roomHosts[roomId] = socket.id;
    socket.join(roomId);
    const clients = getAllConnectedClients(roomId);
    
    clients.forEach(({ socketId }) => {
      io.to(socketId).emit(ACTIONS.JOINED, { clients, username });
    });
  } else {
    // Room exists - request approval
    if (!pendingJoinRequests[roomId]) {
      pendingJoinRequests[roomId] = [];
    }
    
    pendingJoinRequests[roomId].push({ socketId: socket.id, username });
    io.to(socket.id).emit(ACTIONS.WAITING_FOR_APPROVAL);
    io.to(roomHosts[roomId]).emit(ACTIONS.JOIN_REQUEST, {
      socketId: socket.id,
      username,
      roomId
    });
  }
});
```

#### User Disconnect/Leave:

```javascript
socket.on('disconnecting', () => {
  const rooms = [...socket.rooms];
  
  rooms.forEach((roomId) => {
    if (roomId === socket.id) return; // Skip socket's own room
    
    if (roomHosts[roomId] === socket.id) {
      // HOST is leaving
      const remainingClients = getAllConnectedClients(roomId)
        .filter(c => c.socketId !== socket.id);
      
      if (remainingClients.length === 0) {
        // Last user left - clean up room
        delete roomHosts[roomId];
        delete roomFileStructures[roomId];
        delete roomFileContents[roomId];
      } else {
        // Transfer host to next user
        const newHost = remainingClients[0];
        roomHosts[roomId] = newHost.socketId;
        
        remainingClients.forEach(client => {
          io.to(client.socketId).emit(ACTIONS.HOST_CHANGED, {
            newHostSocketId: newHost.socketId,
            clients: remainingClients
          });
        });
      }
    } else {
      // Non-host is leaving
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id]
      });
    }
  });
});
```

### Real-Time Features

#### 1. **Code Synchronization**

**Cursor/Selection Tracking:**
```javascript
socket.on(ACTIONS.CURSOR_CHANGE, ({ roomId, cursor, selection }) => {
  socket.in(roomId).emit(ACTIONS.CURSOR_CHANGE, {
    socketId: socket.id,
    username: userSocketMap[socket.id],
    cursor,
    selection
  });
});
```

**Code Change Broadcasting:**
```javascript
socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code, filePath }) => {
  // Update server state
  if (roomFileContents[roomId]) {
    roomFileContents[roomId][filePath] = code;
    
    // Persist to disk
    fileManager.saveFile(roomId, filePath, code);
  }
  
  // Broadcast to ALL other users (even if they're not viewing that file)
  socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code, filePath });
});
```

#### 2. **Approval System**

**Host Approves Join Request:**
```javascript
socket.on(ACTIONS.APPROVE_JOIN, ({ socketId, roomId }) => {
  // Verify sender is host
  if (roomHosts[roomId] !== socket.id) return;
  
  // Remove from pending
  pendingJoinRequests[roomId] = pendingJoinRequests[roomId]
    .filter(req => req.socketId !== socketId);
  
  // Add to room
  const joiningSocket = io.sockets.sockets.get(socketId);
  if (joiningSocket) {
    joiningSocket.join(roomId);
    const clients = getAllConnectedClients(roomId);
    
    clients.forEach(({ socketId: clientId }) => {
      io.to(clientId).emit(ACTIONS.JOINED, { clients });
    });
  }
});
```

#### 3. **File Structure Initialization**

**On First User Join:**
```javascript
socket.on(ACTIONS.FILE_STRUCTURE_SYNC, ({ 
  fileStructure, 
  fileContents, 
  socketId 
}) => {
  const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
  
  // Only first user can initialize
  if (!roomFileStructures[roomId]) {
    roomFileStructures[roomId] = fileStructure;
    roomFileContents[roomId] = fileContents || {};
    
    // Persist to disk
    fileManager.initializeProject(roomId, fileContents || {});
  }
  
  // Send current state to all users (including the one who sent it)
  io.to(socketId).emit(ACTIONS.FILE_STRUCTURE_UPDATE, {
    fileStructure: roomFileStructures[roomId],
    fileContents: roomFileContents[roomId] || {}
  });
});
```

### Language Support

**Supported Languages for Compilation:**
```javascript
const languageConfig = {
  python3: { pistonLang: 'python', extension: 'py' },
  java: { pistonLang: 'java', extension: 'java' },
  cpp: { pistonLang: 'c++', extension: 'cpp' },
  c: { pistonLang: 'c', extension: 'c' }
};
```

**Compilation Process:**
1. Client sends code + language + input
2. Server validates language
3. Makes API call to Piston API
4. Returns output to client
5. Broadcasts execution result (optional)

### Error Handling

**Connection Error Handling:**
```javascript
io.engine.on('connection_error', (err) => {
  console.error('Engine connection error:', {
    message: err.message,
    origin: err.req.headers.origin
  });
});

socket.on('connect_error', (err) => {
  console.error('Socket connection error:', err);
});
```

**Timeout Configuration:**
```javascript
pingTimeout: 60000,      // 60 seconds
pingInterval: 25000,     // 25 seconds
reconnectionAttempts: Infinity,
```

---

## Communication Architecture

### Socket.IO Events Reference

#### Room Management
| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `join` | Client→Server | `{roomId, username}` | Join a collaboration room |
| `joined` | Server→Client | `{clients, username, socketId}` | Notify new user joined |
| `disconnected` | Server→Client | `{socketId, username}` | Notify user left |
| `join-request` | Server→Host | `{socketId, username, roomId}` | Host approves/rejects |
| `waiting-for-approval` | Server→Client | - | Waiting for host approval |
| `join-rejected` | Server→Client | `{roomId}` | Request was rejected |
| `approve-join` | Client→Server | `{socketId, roomId}` | Host approves join |
| `reject-join` | Client→Server | `{socketId, roomId}` | Host rejects join |
| `host-changed` | Server→Clients | `{newHostSocketId, clients}` | Host transferred to new user |

#### Code Collaboration
| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `conde-change` | Bidirectional | `{roomId, code, filePath}` | Code changed, broadcast |
| `cursor-change` | Bidirectional | `{roomId, cursor, selection}` | Cursor/selection changed |
| `sync-code` | Client→Server | `{socketId, code}` | Sync code to new user |

#### File Operations
| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `file-structure-sync` | Client→Server | `{fileStructure, fileContents, socketId}` | Sync file structure |
| `file-structure-update` | Server→Clients | `{fileStructure, fileContents}` | Update file structure |
| `file-create` | Client→Server | `{roomId, path, fileName}` | Create new file |
| `file-delete` | Client→Server | `{roomId, path}` | Delete file |
| `file-rename` | Client→Server | `{roomId, oldPath, newPath}` | Rename file |
| `folder-create` | Client→Server | `{roomId, path, folderName}` | Create new folder |

#### Voice Calling
| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `join-call` | Client→Server | `{roomId}` | User joins voice call |
| `leave-call` | Client→Server | `{roomId}` | User leaves voice call |
| `call-user-joined` | Server→Clients | `{socketId, username}` | New user in call |
| `call-user-left` | Server→Clients | `{socketId, username}` | User left call |
| `webrtc-offer` | Signaling | `{offer, to, roomId}` | WebRTC offer |
| `webrtc-answer` | Signaling | `{answer, to}` | WebRTC answer |
| `webrtc-ice-candidate` | Signaling | `{candidate, to}` | ICE candidate |

### Data Flow Diagrams

#### Scenario 1: User Joins and Edits Code

```
Timeline:
─────────────────────────────────────────────────

User A (Host)        Server              User B (Joined)
   │                   │                      │
   ├─ JOIN ──────────> │                      │
   │                   │ (initialize room)   │
   │<──── JOINED ──────┤                      │
   │                   │                      │
   │ (opens index.js)  │                      │
   │ (types code)      │                      │
   │                   │                      │
   ├─ FILE_STRUCT ──> │                      │
   │   _SYNC           │ (store structure)   │
   │                   │                      │
   │                   │                      │
   │                   │ (User B connects)  │
   │                   │<─ JOIN ─────────────┤
   │                   │                      │
   │                   │ (check if host ok)  │
   │                   ├─ JOIN_REQUEST ──> │
   │                   │ (waits for approval)
   │ (approves)        │                      │
   ├─ APPROVE_JOIN ──> │                      │
   │                   ├─ JOINED ────────── │
   │                   │ (User B now in room)
   │                   │                      │
   │ (edits code)      │                      │
   ├─ CODE_CHANGE ──> │                      │
   │                   ├─ FILE_STRUCT ────> │
   │                   │ _UPDATE             │
   │                   │                      │
   │                   ├─ CODE_CHANGE ────> │
   │                   │                      │
   │ (saves to disk)   │ (User B sees change)
   │                   │                      │
```

#### Scenario 2: WebRTC Voice Call Setup

```
User A Initiates Call:

User A              Server           User B (Idle)
  │                   │                  │
  ├─ JOIN_CALL ────> │                  │
  │                  ├─ CALL_USER ────> │
  │                  │   _JOINED        │
  │ (initializes    │                  │ (gets notification)
  │  microphone)    │                  │ (asks for permission)
  │                 │                  │
  │                 │<─ JOIN_CALL ─────┤
  │                 ├─ CALL_USER ────> │
  │                 │   _JOINED        │
  │ (microphone ok) │                  │
  │                 │                  │ (initializes mic)
  │ (creates offer) │                  │
  ├─ WEBRTC_OFFER ─ │                  │
  │ ──────────────> │ ──────────────── │
  │                 │                  │ (creates peer conn)
  │                 │ (relays)         │ (receives offer)
  │                 │                  │
  │                 │<─ WEBRTC ────────┤
  │                 │   _ANSWER ───── │
  │<─ WEBRTC ──────┤                  │
  │   _ANSWER ─────┤ (relays)         │
  │ (sets answer)  │                  │ (sets local desc)
  │                │                  │
  │ ╔═══════════════ ICE CANDIDATES ═══════════════╗
  │ ║ (exchange multiple times for NAT traversal)  ║
  │ ╚══════════════════════════════════════════════╝
  │                │                  │
  │◄───── P2P AUDIO STREAM ────────────►│
  │          (Direct connection)       │
  │                │                  │
  │ (ongoing)      │                  │
  │ Audio exchange │                  │
  │                │                  │
```

---

## Data Flow

### Complete Real-Time Collaboration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMPLETE SYSTEM FLOW                         │
└─────────────────────────────────────────────────────────────────┘

                          INITIALIZATION PHASE

                              Browser
                                 │
                                 ├─ React App Starts
                                 ├─ Socket.IO Client Init
                                 └─ Emit: JOIN { roomId, username }
                                       │
                                       ↓
                         ┌─────────────────────────┐
                         │   Express + Socket.IO   │
                         │      Backend Server     │
                         └─────────────────────────┘
                                       │
                         ┌─────────────┴─────────────┐
                         │                           │
                   Room Exists?                 New Room?
                   (Host exists)                  │
                         │                         │
                   Set as Host             Add to Pending
                    Join Room             Emit: WAITING_FOR_APPROVAL
                    Emit: JOINED                   │
                                          ┌─────────────────┐
                                          │ Host Reviews    │
                                          │ Approve/Reject  │
                                          └────┬────────┬──┘
                                               │        │
                                         APPROVE    REJECT
                                               │        │
                                            Join    Disconnect
                                            Room     User
                                               │
                                         Emit: JOINED


                       FILE STRUCTURE INITIALIZATION PHASE

    First Joining User              Server              Database (MongoDB)
           │                          │                      │
           ├─ FILE_STRUCTURE_SYNC ──> │                      │
           │   (structure +           │ (store in-memory)   │
           │    fileContents)         │                      │
           │                          ├─ Save Project ────> │
           │                          │ (for recovery)      │
           │                          │                      │
           │                          ├─ Initialize ────>   Project persisted
           │                          │  on Disk            (fileManager)
           │                          │                      │
           │<─ FILE_STRUCTURE_UPDATE ─┤                      │
           │  (confirmed structure)   │                      │


              CODE EDITING & REAL-TIME SYNCHRONIZATION PHASE

User A                              Server               User B
Editing                                │              (Viewing)
  │                                     │                   │
  ├─ (types code) ──────────────────┐  │                   │
  │  onChange() called              │  │                   │
  │                                 │  │                   │
  ├─ CODE_CHANGE ───────────────>  │  │                   │
  │  {filePath, code}              │  │                   │
  │                                 │  ├─ Update RAM     │
  │                                 │  ├─ Save Disk      │
  │                                 │  │                   │
  │                                 │  ├─ CODE_CHANGE ──> │
  │                                 │  │ (broadcast)      │
  │                                 │  │                   │
  │                                 │  │ fileContents ───> │
  │                                 │  │ [filePath] updated
  │                                 │  │                   │
  │                                 │  │ ┌─ Active File? ─┐
  │                                 │  │ │    YES     NO   │
  │                                 │  │ │     │       │   │
  │                                 │  │ └─ Re-render Store
  │                                 │  │    Editor   State
  │                                 │  │                   │


                         FILE OPERATIONS PHASE

User Creates File              Server                  All Users
       │                           │                      │
       ├─ FILE_CREATE ──────────> │                      │
       │  {path, fileName}        │                      │
       │                          ├─ Update Structure  │
       │                          ├─ Create on Disk    │
       │                          │                      │
       │                          ├─ FILE_STRUCTURE ──> All Users
       │                          │  _UPDATE           Receive
       │                          │ (broadcast)        Update
       │                          │                      │
       │<─────────────────────────┤                      │
       │ Update to local UI       │                      │


                      VOICE CALLING PHASE

    User A (Initiator)      Server (Signaling)    User B (Receiver)
           │                        │                    │
           ├─ JOIN_CALL ──────────> │                    │
           │ (request call)         ├─ CALL_USER ──────> │
           │                        │   _JOINED         │
           │ (init microphone)      │                    │ (request mic)
           │                        │                    │
           │                        │<─ JOIN_CALL ──────┤
           │                        ├─ CALL_USER ──────> │
           │                        │   _JOINED         │
           │                        │                    │
           │ (create RTCPeerConn)   │ (create RTCPeerConn)
           │ (create offer)         │                    │
           │                        │                    │
           ├─ WEBRTC_OFFER ────────> │ ──────────────── │
           │                        │ (relay)           │
           │                        │                    │
           │                        │<─ WEBRTC_ANSWER ──┤
           │<─ WEBRTC_ANSWER ───────┤ (relay)           │
           │                        │                    │
           │ ╔═══════════════════════════════════════╗  │
           │ ║  Exchange ICE Candidates              ║  │
           │ ║  (negotiate network path)             ║  │
           │ ╚═══════════════════════════════════════╝  │
           │                        │                    │
           ├───────────────────────────────────────────>│
           │ Peer-to-Peer Audio Stream (Encrypted)      │
           │<───────────────────────────────────────────┤
           │                        │                    │


                    DISCONNECTION & CLEANUP PHASE

User Leaves              Server                   Other Users
      │                    │                           │
      ├─ disconnect ──────> │                           │
      │ (browser close)     │                           │
      │                     ├─ Is Host?                │
      │                     │    │                      │
      │                  YES│   NO                      │
      │                     │    ├─ DISCONNECTED ────> │
      │              Transfer    │ (just notify)       │
      │                 Host     │                      │
      │                     │    │                      │
      │ (waiting)           │    │                      │
      │                     ├─ HOST_CHANGED ────────> │
      │                     │ (new host)               │
      │                     │                           │
      │                     ├─ Cleanup:                │
      │                     │  • Remove from userMap   │
      │                     │  • Update pending list   │
      │                     │  • Keep room if users    │
      │                     │    still connected       │
```

---

## Technologies Used

### Frontend Stack
```
React 18.2.0                  - UI framework
CodeMirror 5.65.15           - Code editor with syntax highlighting
Socket.IO Client 4.7.2       - Real-time bidirectional comm
WebRTC API                   - Peer-to-peer voice calls
React Router DOM 6.15.0      - Routing & navigation
React Hot Toast 2.4.1        - Notifications/toasts
Axios 1.7.7                  - HTTP client
Bootstrap 5.3.1              - CSS framework
UUID 9.0.0                   - Unique ID generation
```

### Backend Stack
```
Node.js + Express 4.18.2     - HTTP server & REST API
Socket.IO Server 4.7.2       - Real-time communication
Mongoose 7.0.0               - MongoDB ODM
MongoDB                      - Database (NoSQL)
Cors 2.8.5                   - Cross-origin handling
Axios 1.7.7                  - HTTP client (for Piston API)
Python-Shell 5.0.0           - Python code execution
Dotenv 16.4.5                - Environment variables
```

### External APIs
```
Piston API                   - Code compilation & execution
Groq API                     - AI code suggestions
Google STUN Servers          - WebRTC NAT traversal
```

### Development Tools
```
React Scripts 5.0.1          - Build tools & dev server
ESLint & Prettier            - Code quality
Git & GitHub                 - Version control
Railway                      - Backend hosting
Vercel                       - Frontend hosting
MongoDB Atlas                - Managed database
```

---

## Summary

**LiveSyntax** is a sophisticated real-time collaborative platform combining:

1. **WebRTC Voice Calling** - P2P audio without intermediary
2. **Multi-File Management** - Hierarchical file structure with disk persistence
3. **Real-Time Sync** - Code changes broadcast to all users instantly
4. **Room Management** - Host-based approval system for access control
5. **Stateful Backend** - In-memory state with MongoDB persistence
6. **Socket.IO Signaling** - Reliable event-based communication

The architecture emphasizes **scalability**, **real-time responsiveness**, and **reliable synchronization** of both code and files across all connected collaborators.

