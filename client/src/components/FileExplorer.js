import React, { useState } from "react";
import "./FileExplorer.css";

// Helper to get icon based on file type
const getFileIcon = (name) => {
  const ext = name.split('.').pop().toLowerCase();
  const iconMap = {
    js: "bi-filetype-js",
    jsx: "bi-filetype-jsx",
    ts: "bi-filetype-ts",
    tsx: "bi-filetype-tsx",
    html: "bi-filetype-html",
    css: "bi-filetype-css",
    json: "bi-filetype-json",
    py: "bi-filetype-py",
    java: "bi-filetype-java",
    cpp: "bi-filetype-cpp",
    c: "bi-file-earmark-code",
    md: "bi-filetype-md",
    txt: "bi-filetype-txt",
    xml: "bi-filetype-xml",
    sql: "bi-filetype-sql",
  };
  return iconMap[ext] || "bi-file-earmark-text";
};

// Helper to get language mode from file extension
export const getLanguageFromFile = (filename) => {
  const ext = filename.split('.').pop().toLowerCase();
  const langMap = {
    js: "javascript",
    jsx: "javascript",
    ts: "javascript",
    tsx: "javascript",
    html: "htmlmixed",
    css: "css",
    json: "javascript",
    py: "python",
    java: "text/x-java",
    cpp: "text/x-c++src",
    c: "text/x-csrc",
    md: "markdown",
    xml: "xml",
    sql: "sql",
  };
  return langMap[ext] || "javascript";
};

// Recursive File Tree Item Component
const FileTreeItem = ({ item, path, level, onSelect, onContextMenu, expandedFolders, onToggleFolder }) => {
  const isFolder = item.type === 'folder';
  const isExpanded = expandedFolders.has(path);
  const currentPath = path;

  const handleClick = () => {
    if (isFolder) {
      onToggleFolder(currentPath);
    } else {
      onSelect(currentPath, item.content);
    }
  };

  const handleRightClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, currentPath, isFolder);
  };

  return (
    <div>
      <div
        className="file-tree-item"
        style={{ paddingLeft: `${level * 16}px` }}
        onClick={handleClick}
        onContextMenu={handleRightClick}
      >
        {isFolder ? (
          <>
            <i className={`bi ${isExpanded ? 'bi-chevron-down' : 'bi-chevron-right'} me-1`} style={{ fontSize: '0.8rem' }}></i>
            <i className={`bi ${isExpanded ? 'bi-folder2-open' : 'bi-folder2'} me-2 text-warning`}></i>
            <span>{item.name}</span>
          </>
        ) : (
          <>
            <i className={`bi ${getFileIcon(item.name)} me-2 text-info`} style={{ marginLeft: '16px' }}></i>
            <span>{item.name}</span>
          </>
        )}
      </div>
      
      {isFolder && isExpanded && item.children && (
        <div>
          {Object.entries(item.children).map(([childName, childItem]) => (
            <FileTreeItem
              key={childName}
              item={childItem}
              path={`${currentPath}/${childName}`}
              level={level + 1}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function FileExplorer({ fileStructure, onFileSelect, onCreateFile, onCreateFolder, onDeleteItem, onRenameItem }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set(['/root']));
  const [contextMenu, setContextMenu] = useState(null);
  const [showInputDialog, setShowInputDialog] = useState(null); // { type: 'file' | 'folder' | 'rename', path: string }
  const [selectedFolderPath, setSelectedFolderPath] = useState('/root'); // Track currently selected folder

  const handleToggleFolder = (path) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
    // When folder is clicked, set it as the selected folder
    setSelectedFolderPath(path);
  };

  const handleContextMenu = (e, path, isFolder) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path,
      isFolder,
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const handleCreateFile = () => {
    setShowInputDialog({ type: 'file', path: contextMenu.path });
    closeContextMenu();
  };

  const handleCreateFolder = () => {
    setShowInputDialog({ type: 'folder', path: contextMenu.path });
    closeContextMenu();
  };

  const handleRename = () => {
    setShowInputDialog({ type: 'rename', path: contextMenu.path });
    closeContextMenu();
  };

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to delete ${contextMenu.path}?`)) {
      onDeleteItem(contextMenu.path);
    }
    closeContextMenu();
  };

  const handleInputSubmit = (value) => {
    if (!value.trim()) {
      setShowInputDialog(null);
      return;
    }

    if (showInputDialog.type === 'file') {
      const newPath = `${showInputDialog.path}/${value}`;
      onCreateFile(newPath);
      // Expand parent folder
      setExpandedFolders(prev => new Set([...prev, showInputDialog.path]));
    } else if (showInputDialog.type === 'folder') {
      const newPath = `${showInputDialog.path}/${value}`;
      onCreateFolder(newPath);
      setExpandedFolders(prev => new Set([...prev, showInputDialog.path]));
    } else if (showInputDialog.type === 'rename') {
      const pathParts = showInputDialog.path.split('/');
      pathParts[pathParts.length - 1] = value;
      const newPath = pathParts.join('/');
      onRenameItem(showInputDialog.path, newPath);
    }
    
    setShowInputDialog(null);
  };

  // Click outside to close context menu
  React.useEffect(() => {
    if (contextMenu) {
      const handleClick = () => closeContextMenu();
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <span className="text-uppercase fw-bold" style={{ fontSize: '0.75rem' }}>Explorer</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button 
            className="btn btn-sm btn-outline-secondary text-light" 
            onClick={() => setShowInputDialog({ type: 'file', path: selectedFolderPath })}
            title="New File"
            style={{ fontSize: '0.7rem', padding: '2px 6px' }}
          >
            + File
          </button>
          <button 
            className="btn btn-sm btn-outline-secondary text-light" 
            onClick={() => setShowInputDialog({ type: 'folder', path: selectedFolderPath })}
            title="New Folder"
            style={{ fontSize: '0.7rem', padding: '2px 6px' }}
          >
            + Folder
          </button>
        </div>
      </div>

      <div className="file-tree">
        {fileStructure && fileStructure.children && (
          Object.entries(fileStructure.children).map(([name, item]) => (
            <FileTreeItem
              key={name}
              item={item}
              path={`/root/${name}`}
              level={0}
              onSelect={onFileSelect}
              onContextMenu={handleContextMenu}
              expandedFolders={expandedFolders}
              onToggleFolder={handleToggleFolder}
            />
          ))
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 10000,
          }}
        >
          {contextMenu.isFolder && (
            <>
              <div className="context-menu-item" onClick={handleCreateFile}>
                <i className="bi bi-file-earmark-plus me-2"></i>New File
              </div>
              <div className="context-menu-item" onClick={handleCreateFolder}>
                <i className="bi bi-folder-plus me-2"></i>New Folder
              </div>
              <div className="context-menu-divider"></div>
            </>
          )}
          <div className="context-menu-item" onClick={handleRename}>
            <i className="bi bi-pencil me-2"></i>Rename
          </div>
          <div className="context-menu-item text-danger" onClick={handleDelete}>
            <i className="bi bi-trash me-2"></i>Delete
          </div>
        </div>
      )}

      {/* Input Dialog */}
      {showInputDialog && (
        <div className="input-dialog-overlay" onClick={() => setShowInputDialog(null)}>
          <div className="input-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="input-dialog-title">
              {showInputDialog.type === 'file' && 'New File'}
              {showInputDialog.type === 'folder' && 'New Folder'}
              {showInputDialog.type === 'rename' && 'Rename'}
            </div>
            <input
              type="text"
              className="form-control"
              placeholder={showInputDialog.type === 'rename' ? 'New name' : 'Name'}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleInputSubmit(e.target.value);
                } else if (e.key === 'Escape') {
                  setShowInputDialog(null);
                }
              }}
            />
            <div className="input-dialog-buttons">
              <button 
                className="btn btn-sm btn-secondary" 
                onClick={() => setShowInputDialog(null)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-sm btn-primary" 
                onClick={(e) => {
                  const input = e.target.parentElement.previousElementSibling;
                  handleInputSubmit(input.value);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileExplorer;
