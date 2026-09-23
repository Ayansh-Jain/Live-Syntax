# Live Syntax

Live Syntax is a collaborative, real-time code editor with a built-in AI assistant, live compilation, and **multi-file/folder support** (like VS Code). It uses CodeMirror on the client, Socket.IO for real-time collaboration (multi-cursor, selections, file sync), an Express + Socket.IO server, a Groq AI integration, and the JDoodle API for running code.

**Overview**
- Real-time collaborative editor (multiple users can edit simultaneously).
- **File Explorer with folders and multiple files** - Create, delete, rename files and folders.
- **Tab system** - Work with multiple files at once, just like VS Code.
- **Language detection** - Automatic syntax highlighting based on file extension.
- Color-coded cursors and selections per user.
- AI assistant that returns corrected code (structured responses).
- Server-side compilation using the JDoodle API.

**Tech stack**
- Frontend: React, CodeMirror (with multiple language modes), Socket.IO client
- Backend: Node.js, Express, Socket.IO server
- Database: MongoDB (via Mongoose)
- AI: Groq API (`GROQ_API_KEY`)
- Compilation: JDoodle API (`JDOODLE_CLIENT_ID` / `JDOODLE_CLIENT_SECRET`)

**Repository structure**
```
client/
  package.json
  src/
    components/
      Editor.js          # Multi-file CodeMirror editor
      EditorPage.js      # Main page with file system state
      FileExplorer.js    # Tree view for files/folders
      FileTabs.js        # Tab bar for open files
      Home.js
      Client.js
    Socket.js
server/
  index.js
  Actions.js
  package.json
  .env (local, NOT committed)
```

**Prerequisites**
- Node.js (v16+ recommended) and npm
- Recommended: Git for cloning and pushing

## Local development

1. Clone the repository

```bash
git clone <your-repo-url>
cd Live-Syntax
```

2. Install dependencies

```bash
# Server
cd server
npm install

# Client (in new terminal)
cd ../client
npm install
```

3. Environment variables

**Copy from examples:**
```bash
# Server
cp server/.env.example server/.env

# Client  
cp client/.env.example client/.env
```

**Server Configuration** (`server/.env`):
```env
PORT=5002
MONGO_URI=mongodb://localhost:27017/live-syntax
FRONTEND_URL=http://localhost:3000
GROQ_API_KEY=your_groq_api_key_here
JDOODLE_CLIENT_ID=your_jdoodle_client_id
JDOODLE_CLIENT_SECRET=your_jdoodle_client_secret
```

**Client Configuration** (`client/.env`):
```env
REACT_APP_BACKEND_URL=http://localhost:5002
```

**Environment Variables Guide:**
- `.env` - Your **local** configuration (add to `.gitignore`)
- `.env.example` - Template showing what variables are needed
- `.env.production` (client only) - Used for production builds on Vercel

**Setup Steps:**
1. Create local `.env` files from `.env.example` templates
2. Get a **free Groq API key** at https://console.groq.com
3. Get **JDoodle API credentials** (Client ID + Secret) at https://www.jdoodle.com/compiler-api
4. Set up MongoDB:
   - **Local**: Run `mongod` on your machine
   - **Cloud**: Use MongoDB Atlas (free tier available)
5. Fill in your values in `.env` files

4. Run server and client

```bash
# Terminal 1 (server)
cd server
npm start

# Terminal 2 (client)
cd client
npm start
```

Open `http://localhost:3000` in your browser.

## Using the File System

Live Syntax now supports a full file/folder structure similar to VS Code:

**Creating Files and Folders:**
- Click the **+ file** icon in the Explorer header to create a new file in the root
- Click the **+ folder** icon to create a new folder
- Right-click on any folder to create files/folders inside it

**Managing Files:**
- Click on a file to open it in the editor
- Files open in tabs at the top of the editor
- Click the **×** on a tab to close it
- Right-click on any file or folder to **Rename** or **Delete**

**Supported File Types:**
- JavaScript (.js, .jsx, .ts, .tsx)
- Python (.py)
- Java (.java)
- C/C++ (.c, .cpp)
- HTML (.html)
- CSS (.css)
- Markdown (.md)
- JSON (.json)
- And more!

**Collaborative File System:**
- All file operations (create, delete, rename) sync across all users in real-time
- Each user sees the same file structure and can edit any file
- Changes to files are synchronized live to all connected users

## Deployment notes

Recommended pairing:
- Frontend: Vercel
- Backend: Railway

Server (Railway):
- Add `MONGO_URI`, `GROQ_API_KEY`, `JDOODLE_CLIENT_ID` and `JDOODLE_CLIENT_SECRET` as environment variables in Railway.
- Set `FRONTEND_URL` to your Vercel URL (e.g. `https://<your-app>.vercel.app`).
- Railway will auto-redeploy when variables change.

Client (Vercel):
- Add `REACT_APP_BACKEND_URL` to Vercel's Environment Variables (Production) with your Railway URL (e.g. `https://<your-app>.up.railway.app`).
- Redeploy the project so the production build includes the correct backend URL.

## Common troubleshooting

- Socket connection failed:
  - Check `client` console for the `Connecting to backend:` message; it shows the URL the client is attempting.
  - Verify `REACT_APP_BACKEND_URL` is set in Vercel and the value is the correct Railway domain.
  - Check `https://<railway-domain>/health` — should return `{"status":"running"}`.
  - In Railway, check Deployments and Logs for any server-side errors.
  - Hard refresh the browser (Ctrl/Cmd + Shift + R) to clear cached frontend code after a redeploy.

- CORS issues:
  - Ensure `FRONTEND_URL` is configured in Railway and server allows that origin in CORS settings.

- If you see `Cannot GET /` when visiting the Railway root URL directly, that's okay — the server may not serve a frontend at `/`; check `/health`.

## Security & secrets
- Never commit `.env` to GitHub.
- Keep API keys private and rotate them if exposed.

## Features implemented
- **Multi-file/folder system** - Create, delete, rename files and folders
- **File Explorer** - Tree view with expand/collapse functionality
- **Tab system** - Multiple open files with tabs
- **Language detection** - Automatic syntax highlighting based on file extension
- Real-time delta-based synchronization across all files
- Multi-cursor support with user-colored cursors
- Selection highlighting (handles top-to-bottom and bottom-to-top selection)
- AI assistant endpoint that returns `Corrected Code:` output
- JDoodle-based compilation endpoint
- File system synchronization across all users in a room




