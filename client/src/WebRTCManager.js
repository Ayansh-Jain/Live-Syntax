// WebRTC Manager for handling peer-to-peer voice calls
import { ACTIONS } from "./Actions";

// Configuration for WebRTC (using Google's public STUN server)
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

class WebRTCManager {
  constructor(socketRef, roomId, username) {
    this.socketRef = socketRef;
    this.roomId = roomId;
    this.username = username;
    this.localStream = null;
    this.peerConnections = {}; // Map of socketId -> RTCPeerConnection
    this.remoteAudioElements = {}; // Map of socketId -> audio element
    this.isMuted = false;
    this.isInCall = false;
  }

  // Initialize audio stream
  async initializeLocalStream() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      console.log("Local audio stream initialized");
      return true;
    } catch (error) {
      console.error("Error accessing microphone:", error);
      throw new Error("Could not access microphone. Please check permissions.");
    }
  }

  // Join the call
  async joinCall(existingUsers = []) {
    if (this.isInCall) {
      console.log("Already in call, ignoring join request");
      return;
    }

    try {
      console.log("Starting to join call...");
      
      // Remove any existing listeners first to avoid duplicates
      this.removeSignalingListeners();
      
      await this.initializeLocalStream();
      this.isInCall = true;

      // Setup socket listeners for WebRTC signaling BEFORE notifying server
      this.setupSignalingListeners();

      // Notify server that we joined the call
      this.socketRef.current.emit(ACTIONS.JOIN_CALL, { roomId: this.roomId });
      console.log("Emitted JOIN_CALL to server");

      // Connect to existing users in the call
      existingUsers.forEach((user) => {
        if (user.socketId !== this.socketRef.current.id) {
          console.log(`Initiating connection to existing user: ${user.username} (${user.socketId})`);
          this.createPeerConnection(user.socketId, true);
        }
      });

      console.log("Joined call successfully");
      return true;
    } catch (error) {
      console.error("Error joining call:", error);
      this.isInCall = false;
      throw error;
    }
  }

  // Leave the call
  leaveCall() {
    if (!this.isInCall) return;

    // Notify server
    this.socketRef.current.emit(ACTIONS.LEAVE_CALL, { roomId: this.roomId });

    // Close all peer connections
    Object.keys(this.peerConnections).forEach((socketId) => {
      this.closePeerConnection(socketId);
    });

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    // Remove signaling listeners
    this.removeSignalingListeners();

    this.isInCall = false;
    console.log("Left call successfully");
  }

  // Toggle mute
  toggleMute() {
    if (!this.localStream) return false;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this.isMuted = !audioTrack.enabled;
      console.log(`Microphone ${this.isMuted ? "muted" : "unmuted"}`);
      return this.isMuted;
    }
    return false;
  }

  // Create peer connection
  createPeerConnection(socketId, shouldCreateOffer) {
    if (this.peerConnections[socketId]) {
      console.log(`Peer connection already exists for ${socketId}`);
      return;
    }

    // Tie-breaker: only the peer with lexicographically smaller socket ID creates the offer
    // This prevents both peers from sending offers simultaneously
    const shouldInitiate = shouldCreateOffer && (this.socketRef.current.id < socketId);
    
    console.log(`Creating peer connection with ${socketId}, shouldInitiate: ${shouldInitiate} (my ID: ${this.socketRef.current.id})`);

    const peerConnection = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections[socketId] = peerConnection;

    // Add local stream tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, this.localStream);
      });
    }

    // Handle incoming remote stream
    peerConnection.ontrack = (event) => {
      console.log(`Received remote track from ${socketId}`);
      this.handleRemoteStream(socketId, event.streams[0]);
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`Sending ICE candidate to ${socketId}`);
        this.socketRef.current.emit(ACTIONS.WEBRTC_ICE_CANDIDATE, {
          candidate: event.candidate,
          to: socketId,
        });
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log(`Connection state with ${socketId}: ${peerConnection.connectionState}`);
      if (
        peerConnection.connectionState === "disconnected" ||
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "closed"
      ) {
        this.closePeerConnection(socketId);
      }
    };

    // Create offer if we are the initiator
    if (shouldInitiate) {
      this.createAndSendOffer(socketId);
    }
  }

  // Create and send offer
  async createAndSendOffer(socketId) {
    const peerConnection = this.peerConnections[socketId];
    if (!peerConnection) return;

    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      console.log(`Sending offer to ${socketId}`);
      this.socketRef.current.emit(ACTIONS.WEBRTC_OFFER, {
        offer,
        to: socketId,
        roomId: this.roomId,
      });
    } catch (error) {
      console.error(`Error creating offer for ${socketId}:`, error);
    }
  }

  // Handle remote stream
  handleRemoteStream(socketId, stream) {
    // Remove existing audio element if any
    if (this.remoteAudioElements[socketId]) {
      this.remoteAudioElements[socketId].srcObject = null;
      this.remoteAudioElements[socketId].remove();
    }

    // Create new audio element
    const audio = document.createElement("audio");
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.id = `remote-audio-${socketId}`;
    document.body.appendChild(audio);

    this.remoteAudioElements[socketId] = audio;
    console.log(`Playing remote audio from ${socketId}`);
  }

  // Close peer connection
  closePeerConnection(socketId) {
    console.log(`Closing peer connection with ${socketId}`);

    if (this.peerConnections[socketId]) {
      this.peerConnections[socketId].close();
      delete this.peerConnections[socketId];
    }

    if (this.remoteAudioElements[socketId]) {
      this.remoteAudioElements[socketId].srcObject = null;
      this.remoteAudioElements[socketId].remove();
      delete this.remoteAudioElements[socketId];
    }
  }

  // Setup signaling listeners
  setupSignalingListeners() {
    // When a new user joins the call
    this.socketRef.current.on(ACTIONS.CALL_USER_JOINED, ({ socketId, username }) => {
      console.log(`${username} joined the call`);
      // Create peer connection and send offer
      this.createPeerConnection(socketId, true);
    });

    // When a user leaves the call
    this.socketRef.current.on(ACTIONS.CALL_USER_LEFT, ({ socketId }) => {
      console.log(`User ${socketId} left the call`);
      this.closePeerConnection(socketId);
    });

    // Handle incoming WebRTC offer
    this.socketRef.current.on(ACTIONS.WEBRTC_OFFER, async ({ offer, from, username }) => {
      console.log(`Received offer from ${username} (${from})`);

      // Create peer connection if it doesn't exist
      if (!this.peerConnections[from]) {
        this.createPeerConnection(from, false);
      }

      const peerConnection = this.peerConnections[from];
      if (!peerConnection) return;

      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        console.log(`Sending answer to ${from}`);
        this.socketRef.current.emit(ACTIONS.WEBRTC_ANSWER, {
          answer,
          to: from,
        });
      } catch (error) {
        console.error(`Error handling offer from ${from}:`, error);
      }
    });

    // Handle incoming WebRTC answer
    this.socketRef.current.on(ACTIONS.WEBRTC_ANSWER, async ({ answer, from }) => {
      console.log(`Received answer from ${from}`);

      const peerConnection = this.peerConnections[from];
      if (!peerConnection) return;

      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error(`Error handling answer from ${from}:`, error);
      }
    });

    // Handle incoming ICE candidate
    this.socketRef.current.on(ACTIONS.WEBRTC_ICE_CANDIDATE, async ({ candidate, from }) => {
      console.log(`Received ICE candidate from ${from}`);

      const peerConnection = this.peerConnections[from];
      if (!peerConnection) return;

      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error(`Error adding ICE candidate from ${from}:`, error);
      }
    });
  }

  // Remove signaling listeners
  removeSignalingListeners() {
    if (!this.socketRef.current) return;
    
    console.log("Removing WebRTC signaling listeners");
    this.socketRef.current.off(ACTIONS.CALL_USER_JOINED);
    this.socketRef.current.off(ACTIONS.CALL_USER_LEFT);
    this.socketRef.current.off(ACTIONS.WEBRTC_OFFER);
    this.socketRef.current.off(ACTIONS.WEBRTC_ANSWER);
    this.socketRef.current.off(ACTIONS.WEBRTC_ICE_CANDIDATE);
  }

  // Cleanup
  cleanup() {
    console.log("Cleaning up WebRTC manager");
    
    // Close all peer connections
    Object.keys(this.peerConnections).forEach((socketId) => {
      this.closePeerConnection(socketId);
    });

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        track.stop();
        console.log("Stopped local track:", track.kind);
      });
      this.localStream = null;
    }

    // Remove signaling listeners
    this.removeSignalingListeners();

    // Reset state
    this.peerConnections = {};
    this.remoteAudioElements = {};
    this.isInCall = false;
    this.isMuted = false;
    
    console.log("WebRTC cleanup complete");
  }
}

export default WebRTCManager;
