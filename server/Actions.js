// All the events

const ACTIONS = {
  JOIN: "join",
  JOINED: "joined",
  DISCONNECTED: "disconnected",
  CODE_CHANGE: "conde-change",
  SYNC_CODE: "sync-code",
  LEAVE: "leave",
  JOIN_REQUEST: "join-request",
  APPROVE_JOIN: "approve-join",
  REJECT_JOIN: "reject-join",
  JOIN_REJECTED: "join-rejected",
  WAITING_FOR_APPROVAL: "waiting-for-approval",
  HOST_CHANGED: "host-changed",
  CURSOR_CHANGE: "cursor-change",
  // Voice call actions
  JOIN_CALL: "join-call",
  LEAVE_CALL: "leave-call",
  CALL_USER_JOINED: "call-user-joined",
  CALL_USER_LEFT: "call-user-left",
  WEBRTC_OFFER: "webrtc-offer",
  WEBRTC_ANSWER: "webrtc-answer",
  WEBRTC_ICE_CANDIDATE: "webrtc-ice-candidate",
  // File system actions
  FILE_STRUCTURE_SYNC: "file-structure-sync",
  FILE_STRUCTURE_UPDATE: "file-structure-update",
  FILE_CREATE: "file-create",
  FILE_DELETE: "file-delete",
  FILE_RENAME: "file-rename",
  FOLDER_CREATE: "folder-create",
  // Sync & versioning actions
  REQUEST_FILE_SYNC: "request-file-sync",
  FILE_SYNC_RESPONSE: "file-sync-response",
  CODE_CONFLICT: "code-conflict",
  STALE_EVENT_REJECTED: "stale-event-rejected",
  SAVE_ERROR: "save-error",
  RECONNECT_SYNC_START: "reconnect-sync-start",
  RECONNECT_SYNC_DONE: "reconnect-sync-done",
};

module.exports = ACTIONS;
