import React from 'react';
import Avatar from 'react-avatar';

// Same color generation as Editor for consistency
const getUserColor = (username) => {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 60%)`;
};

function Client({username, isHost, inCall}) {
  const userColor = getUserColor(username.toString());

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 14px',
      borderRadius: 'var(--radius-sm)',
      transition: 'background var(--transition-fast)',
      cursor: 'default',
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-surface)'}
    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar 
          name={username.toString()} 
          size={32} 
          round="8px" 
          color={userColor}
          textSizeRatio={2.2}
          style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: 13,
          }}
        />
        {/* Online indicator */}
        <div style={{
          position: 'absolute',
          bottom: -1,
          right: -1,
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: 'var(--success)',
          border: '2px solid var(--bg-secondary)',
        }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          {username.toString()}
          {isHost && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'var(--warning)',
              background: 'rgba(210, 153, 34, 0.12)',
              padding: '1px 6px',
              borderRadius: 4,
              letterSpacing: '0.3px',
            }}>HOST</span>
          )}
          {inCall && (
            <i className="bi bi-mic-fill" style={{ 
              fontSize: 11, 
              color: 'var(--success)',
            }} title="In call" />
          )}
        </div>
      </div>
    </div>
  );
}

export default Client;
