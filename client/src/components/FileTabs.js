import React from "react";
import "./FileTabs.css";

function FileTabs({ openFiles, activeFile, onSelectFile, onCloseFile }) {
  // Get just the filename from path
  const getFileName = (path) => {
    return path.split('/').pop();
  };

  // Get icon for file
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
    };
    return iconMap[ext] || "bi-file-earmark-text";
  };

  const handleCloseFile = (e, path) => {
    e.stopPropagation();
    onCloseFile(path);
  };

  return (
    <div className="file-tabs">
      {openFiles.map((filePath) => (
        <div
          key={filePath}
          className={`file-tab ${activeFile === filePath ? 'active' : ''}`}
          onClick={() => onSelectFile(filePath)}
        >
          <i className={`bi ${getFileIcon(getFileName(filePath))} me-2 text-info`} style={{ fontSize: '0.9rem' }}></i>
          <span className="file-tab-name">{getFileName(filePath)}</span>
          <button 
            className="file-tab-close" 
            onClick={(e) => handleCloseFile(e, filePath)}
            title="Close"
          >
            <i className="bi bi-x"></i>
          </button>
        </div>
      ))}
    </div>
  );
}

export default FileTabs;
