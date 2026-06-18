/* اَلِ من خورا — WebRTC voice chat (mesh, per room) */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export class VoiceChat {
  constructor(socket) {
    this.socket = socket;
    this.peers = new Map();      // socketId → RTCPeerConnection
    this.participants = new Map(); // socketId → {name, seat, muted}
    this.localStream = null;
    this.muted = false;
    this.active = false;
    this.onUpdate = null;          // called whenever participant list changes
    this.onSpectatorRequest = null; // called with {socketId, name} when spectator asks

    this._handlers = {
      'voice:joined': (d) => this._onPeerJoined(d),
      'voice:left': (d) => this._onPeerLeft(d),
      'voice:signal': (d) => this._onSignal(d),
      'voice:spectator-request': (d) => this.onSpectatorRequest?.(d),
      'voice:spectator-granted': () => this._onGranted(),
      'voice:spectator-denied': () => this._onDenied(),
    };
    for (const [ev, fn] of Object.entries(this._handlers)) socket.on(ev, fn);
  }

  /* ----------------------- Public API ----------------------- */

  async join() {
    if (this.active) return;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.active = true;
      this.muted = false;
      this.socket.emit('voice:join');
      this.onUpdate?.();
    } catch {
      throw new Error('mic-denied');
    }
  }

  leave() {
    if (!this.active) return;
    this.socket.emit('voice:leave');
    this._closeAll();
    this.active = false;
    this.participants.clear();
    this.onUpdate?.();
  }

  toggleMute() {
    if (!this.localStream) return false;
    this.muted = !this.muted;
    for (const t of this.localStream.getAudioTracks()) t.enabled = !this.muted;
    this.onUpdate?.();
    return this.muted;
  }

  requestSpectatorAccess() {
    this.socket.emit('voice:spectator-request');
  }

  voteSpectator(requesterId, accept) {
    this.socket.emit('voice:spectator-vote', { requesterId, accept });
  }

  destroy() {
    this.leave();
    for (const [ev, fn] of Object.entries(this._handlers)) this.socket.off(ev, fn);
  }

  /* -------------------- Socket event handlers -------------------- */

  _onPeerJoined({ socketId, name, seat, existingMember }) {
    this.participants.set(socketId, { name, seat: seat ?? -1, muted: false });
    if (this.active && !this.peers.has(socketId)) {
      // existingMember means that remote side will initiate; we answer.
      this._createPeer(socketId, !existingMember);
    }
    this.onUpdate?.();
  }

  _onPeerLeft({ socketId }) {
    const pc = this.peers.get(socketId);
    if (pc) { pc.close(); this.peers.delete(socketId); }
    this.participants.delete(socketId);
    document.querySelector(`audio[data-vc="${socketId}"]`)?.remove();
    this.onUpdate?.();
  }

  async _onSignal({ from, data }) {
    let pc = this.peers.get(from);
    if (!pc) pc = this._createPeer(from, false);
    try {
      if (data.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        this.socket.emit('voice:signal', { to: from, data: { type: 'answer', sdp: ans } });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.type === 'ice' && data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch { /* ignore stale signals */ }
  }

  _onGranted() {
    this.join().catch(() => {});
  }

  _onDenied() {
    this.onUpdate?.('denied');
  }

  /* ---------------------- RTCPeerConnection ---------------------- */

  _createPeer(socketId, isInitiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(socketId, pc);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket.emit('voice:signal', { to: socketId, data: { type: 'ice', candidate } });
    };

    pc.ontrack = ({ streams }) => {
      let el = document.querySelector(`audio[data-vc="${socketId}"]`);
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        el.dataset.vc = socketId;
        document.body.appendChild(el);
      }
      el.srcObject = streams[0];
    };

    if (isInitiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() =>
          this.socket.emit('voice:signal', { to: socketId, data: { type: 'offer', sdp: offer } }),
        ))
        .catch(() => {});
    }

    return pc;
  }

  _closeAll() {
    for (const [sid, pc] of this.peers) {
      pc.close();
      document.querySelector(`audio[data-vc="${sid}"]`)?.remove();
    }
    this.peers.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
  }
}
