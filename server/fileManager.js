const fs = require('fs');
const path = require('path');

// Directory to store temporary project files
const PROJECTS_DIR = path.join(__dirname, 'projects');

// Ensure projects directory exists
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

// ── Path Traversal Guard (BUG 14) ──────────────────────────────
function validatePath(roomId, filePath) {
  const projectRoot = path.resolve(PROJECTS_DIR, roomId);
  const fileName = filePath.split('/').pop();
  const folderPath = filePath.split('/').slice(1, -1).join('/');
  const resolved = path.resolve(PROJECTS_DIR, roomId, folderPath, fileName);

  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path traversal blocked: ${filePath} resolves outside project directory`);
  }
  return resolved;
}

// Create project directory
function createProjectDirectory(roomId) {
  const projectPath = path.join(PROJECTS_DIR, roomId);
  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }
  return projectPath;
}

// Get file path for a specific file in a project
function getFilePath(roomId, filePath) {
  // Validate + resolve (throws on traversal)
  const fullPath = validatePath(roomId, filePath);

  // Ensure the directory exists
  const dirName = path.dirname(fullPath);
  if (!fs.existsSync(dirName)) {
    fs.mkdirSync(dirName, { recursive: true });
  }

  return fullPath;
}

// Save file content to disk (with retry-once logic)
function saveFile(roomId, filePath, content) {
  const attempt = (retryCount) => {
    try {
      const fullPath = getFilePath(roomId, filePath);
      fs.writeFileSync(fullPath, content, 'utf-8');

      // Read-back verification
      const readBack = fs.readFileSync(fullPath, 'utf-8');
      if (readBack !== content) {
        throw new Error('Read-back verification failed: content mismatch');
      }

      return { success: true, error: null };
    } catch (err) {
      if (retryCount > 0) {
        console.warn(`Retrying save for ${filePath}:`, err.message);
        return attempt(retryCount - 1);
      }
      console.error(`Error saving file ${filePath}:`, err);
      return { success: false, error: err.message };
    }
  };

  return attempt(1); // 1 retry
}

// Read file content from disk
function readFile(roomId, filePath) {
  try {
    const fullPath = getFilePath(roomId, filePath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      return content;
    }
    return '';
  } catch (err) {
    console.error(`Error reading file ${filePath}:`, err);
    return '';
  }
}

// Get all files in a project and their contents
function getAllFiles(roomId) {
  try {
    const projectPath = path.join(PROJECTS_DIR, roomId);
    if (!fs.existsSync(projectPath)) {
      return {};
    }

    const fileContents = {};

    function walkDir(dir, baseDir = '') {
      const files = fs.readdirSync(dir);

      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walkDir(fullPath, baseDir + '/' + file);
        } else {
          const relativePath = path.relative(projectPath, fullPath);
          const fileKey = '/root/' + relativePath.replace(/\\\\/g, '/');
          const content = fs.readFileSync(fullPath, 'utf-8');
          fileContents[fileKey] = content;
        }
      }
    }

    walkDir(projectPath);
    return fileContents;
  } catch (err) {
    console.error(`Error getting all files for ${roomId}:`, err);
    return {};
  }
}

// Delete project directory
function deleteProject(roomId) {
  try {
    const projectPath = path.join(PROJECTS_DIR, roomId);
    if (fs.existsSync(projectPath)) {
      fs.rmSync(projectPath, { recursive: true, force: true });
      console.log(`Deleted project: ${projectPath}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Error deleting project ${roomId}:`, err);
    return false;
  }
}

// Initialize project files from fileContents
function initializeProject(roomId, fileContents) {
  try {
    createProjectDirectory(roomId);

    for (const [filePath, content] of Object.entries(fileContents)) {
      saveFile(roomId, filePath, content);
    }

    console.log(`Initialized project ${roomId} with ${Object.keys(fileContents).length} files`);
    return true;
  } catch (err) {
    console.error(`Error initializing project ${roomId}:`, err);
    return false;
  }
}

module.exports = {
  createProjectDirectory,
  getFilePath,
  saveFile,
  readFile,
  getAllFiles,
  deleteProject,
  initializeProject,
};
