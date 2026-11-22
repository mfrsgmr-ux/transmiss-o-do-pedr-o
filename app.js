/* ==========================================================================
   Transmissão Do Pedrão — Screen Share P2P (PeerJS + WebRTC Nativo)
   Arquitetura 100% estática (HTML/CSS/JS puro), pronta para GitHub Pages/Vercel
========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     Constantes e Configuração WebRTC / PeerJS
  ------------------------------------------------------------------------ */
  const MAX_VIEWERS = 6;
  const ROOM_ID_LENGTH = 6;
  const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PEER_HOST_PREFIX = 'tdp-host-';
  const PEER_VIEWER_PREFIX = 'tdp-viewer-';

  const RESOLUTIONS = {
    '720p': { width: 1280, height: 720, label: '1280 × 720' },
    '1080p': { width: 1920, height: 1080, label: '1920 × 1080' }
  };

  // Configuração obrigatória com servidores STUN públicos do Google
  const PEER_CONFIG = {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  };

  /* ------------------------------------------------------------------------
     Estado Global da Aplicação
  ------------------------------------------------------------------------ */
  const state = {
    mode: 'landing', // 'landing' | 'host' | 'viewer'
    sessionSeq: 0,
    peer: null,
    roomId: null,
    localName: '',
    isCleaningUp: false,

    host: {
      resolution: '1080p',
      fps: 60,
      bitrateMbps: 2.5,
      captureAudio: true,
      stream: null,
      previewHidden: false,
      startedAt: null,
      uptimeTimer: null,
      statsTimer: null,
      bitrateDebounce: null,
      // Map<peerId, { id, name, joinedAt, dataConn, mediaCall, rttMs, outboundMbps, prevBytesSent, prevStatsTs, bitrateQueue }>
      viewers: new Map()
    },

    viewer: {
      hostPeerId: null,
      dataConn: null,
      mediaCall: null,
      remoteStream: null,
      isStreaming: false,
      participants: [],
      streamConfig: null,
      cinemaExpanded: false,
      statsVisible: false,
      volume: loadSavedVolume(),
      muted: false,
      lastVolumeBeforeMute: 100,
      pingTimer: null,
      statsTimer: null,
      controlsHideTimer: null,
      lastPingRtt: null,
      lastWebRtcRtt: null,
      prevBytesRecv: 0,
      prevStatsTs: 0,
      connectionTimeout: null
    }
  };

  /* ------------------------------------------------------------------------
     Cache de Elementos DOM
  ------------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);

  const el = {
    // Views
    viewLanding: $('view-landing'),
    viewHost: $('view-host'),
    viewViewer: $('view-viewer'),

    // Landing
    inviteBanner: $('invite-banner'),
    inviteRoomCode: $('invite-room-code'),
    btnClearInvite: $('btn-clear-invite'),
    cardJoinViewer: $('card-join-viewer'),
    formCreateRoom: $('form-create-room'),
    inputHostName: $('input-host-name'),
    btnCreateRoom: $('btn-create-room'),
    formJoinRoom: $('form-join-room'),
    inputRoomId: $('input-room-id'),
    inputViewerName: $('input-viewer-name'),
    btnJoinRoom: $('btn-join-room'),

    // Host Topbar & Preview
    hostRoomIdText: $('host-room-id-text'),
    btnCopyRoomId: $('btn-copy-room-id'),
    btnCopyRoomLink: $('btn-copy-room-link'),
    hostLiveBadge: $('host-live-badge'),
    hostLiveText: $('host-live-text'),
    hostUptime: $('host-uptime'),
    hostViewerCount: $('host-viewer-count'),
    btnCloseRoom: $('btn-close-room'),
    hostPreviewVideo: $('host-preview-video'),
    hostPreviewEmpty: $('host-preview-empty'),
    hostPreviewPausedUi: $('host-preview-paused-ui'),
    hostPreviewHud: $('host-preview-hud'),
    hostActualSpec: $('host-actual-spec'),
    hostAudioChip: $('host-audio-chip'),
    btnStartShareHero: $('btn-start-share-hero'),
    btnShowPreviewInline: $('btn-show-preview-inline'),
    btnToggleShare: $('btn-toggle-share'),
    btnToggleShareLabel: $('btn-toggle-share-label'),
    btnSwitchSource: $('btn-switch-source'),
    btnTogglePreview: $('btn-toggle-preview'),
    btnTogglePreviewLabel: $('btn-toggle-preview-label'),
    hostRealUpload: $('host-real-upload'),
    hostCapUpload: $('host-cap-upload'),
    hostDirectLinkText: $('host-direct-link-text'),
    btnCopyDirectLinkBar: $('btn-copy-direct-link-bar'),

    // Host Settings & Roster
    resolutionButtons: Array.from(document.querySelectorAll('[data-resolution]')),
    fpsButtons: Array.from(document.querySelectorAll('[data-fps]')),
    labelResolutionDetail: $('label-resolution-detail'),
    labelFpsDetail: $('label-fps-detail'),
    sliderBitrate: $('slider-bitrate'),
    bitrateValueBadge: $('bitrate-value-badge'),
    bitrateMax6Estimate: $('bitrate-max-6-estimate'),
    checkboxSystemAudio: $('checkbox-system-audio'),
    hostRoomCountBadge: $('host-room-count-badge'),
    hostParticipantsList: $('host-participants-list'),

    // Viewer Topbar
    viewerRoomIdText: $('viewer-room-id-text'),
    btnViewerCopyRoom: $('btn-viewer-copy-room'),
    viewerConnStatus: $('viewer-conn-status'),
    viewerConnText: $('viewer-conn-text'),
    viewerLatencyPill: $('viewer-latency-pill'),
    viewerLatencyValue: $('viewer-latency-value'),
    btnToggleStats: $('btn-toggle-stats'),
    btnToggleCinema: $('btn-toggle-cinema'),
    btnLeaveRoom: $('btn-leave-room'),

    // Viewer Stage & Controls
    viewerLayout: $('viewer-layout'),
    viewerStage: $('viewer-stage'),
    viewerVideo: $('viewer-video'),
    viewerOverlay: $('viewer-overlay'),
    viewerSpinner: $('viewer-spinner'),
    viewerOverlayTitle: $('viewer-overlay-title'),
    viewerOverlayDesc: $('viewer-overlay-desc'),
    viewerOverlayActions: $('viewer-overlay-actions'),
    btnViewerRetry: $('btn-viewer-retry'),
    btnViewerBack: $('btn-viewer-back'),
    btnUnmuteBanner: $('btn-unmute-banner'),
    viewerStatsHud: $('viewer-stats-hud'),
    statRes: $('stat-res'),
    statFps: $('stat-fps'),
    statBitrate: $('stat-bitrate'),
    statRtt: $('stat-rtt'),
    statLoss: $('stat-loss'),
    viewerControls: $('viewer-controls'),
    playerLiveTag: $('player-live-tag'),
    btnMute: $('btn-mute'),
    iconVolOn: $('icon-vol-on'),
    iconVolOff: $('icon-vol-off'),
    sliderVolume: $('slider-volume'),
    volumePercent: $('volume-percent'),
    playerStreamMeta: $('player-stream-meta'),
    btnPip: $('btn-pip'),
    btnStageCinema: $('btn-stage-cinema'),
    btnFullscreen: $('btn-fullscreen'),
    iconFsEnter: $('icon-fs-enter'),
    iconFsExit: $('icon-fs-exit'),

    // Viewer Roster
    viewerRoomCountBadge: $('viewer-room-count-badge'),
    viewerParticipantsList: $('viewer-participants-list'),

    // Toasts
    toastContainer: $('toast-container')
  };

  /* ------------------------------------------------------------------------
     Utilitários
  ------------------------------------------------------------------------ */
  function generateShortRoomId() {
    const bytes = new Uint8Array(ROOM_ID_LENGTH);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    let id = '';
    for (let i = 0; i < ROOM_ID_LENGTH; i++) {
      id += ROOM_ID_ALPHABET[bytes[i] % ROOM_ID_ALPHABET.length];
    }
    return id;
  }

  function generateViewerPeerId() {
    const rand = Math.random().toString(36).slice(2, 8);
    const ts = Date.now().toString(36).slice(-4);
    return `${PEER_VIEWER_PREFIX}${ts}${rand}`;
  }

  function extractRoomId(rawInput) {
    if (!rawInput) return '';
    const trimmed = String(rawInput).trim();
    if (!trimmed) return '';

    // Se o usuário colou um link completo ou query string com ?room=ID
    try {
      if (trimmed.includes('room=')) {
        const fakeUrl = trimmed.startsWith('http')
          ? new URL(trimmed)
          : new URL(trimmed.startsWith('?') ? `https://local/${trimmed}` : `https://local/?${trimmed}`);
        const fromQuery = fakeUrl.searchParams.get('room');
        if (fromQuery) {
          return fromQuery.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase().slice(0, 16);
        }
      }
    } catch (_) {
      // Fallback para sanitização simples
    }

    return trimmed.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase().slice(0, 16);
  }

  function buildShareUrl(roomId) {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('room', roomId);
    return url.toString();
  }

  async function copyToClipboard(text, successMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      showToast(successMsg, 'success');
      return true;
    } catch (err) {
      console.error('[Clipboard] Erro ao copiar:', err);
      showToast('Não foi possível copiar automaticamente.', 'error');
      return false;
    }
  }

  function showToast(message, type = 'info', durationMs = 3200) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const dot = document.createElement('span');
    dot.className = 'toast-dot';

    const text = document.createElement('span');
    text.textContent = message;

    toast.appendChild(dot);
    toast.appendChild(text);
    el.toastContainer.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('toast-out');
      window.setTimeout(() => toast.remove(), 220);
    }, durationMs);
  }

  function switchView(target) {
    state.mode = target;
    el.viewLanding.classList.toggle('hidden', target !== 'landing');
    el.viewHost.classList.toggle('hidden', target !== 'host');
    el.viewViewer.classList.toggle('hidden', target !== 'viewer');
  }

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  }

  function getInitials(name) {
    const clean = (name || '?').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return clean.slice(0, 2).toUpperCase();
  }

  function loadSavedVolume() {
    try {
      const saved = localStorage.getItem('tdp_viewer_volume');
      if (saved !== null) {
        const parsed = Number(saved);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) {
          return parsed;
        }
      }
    } catch (_) {
      // Ignora restrições de storage
    }
    return 100;
  }

  function saveVolume(val) {
    try {
      localStorage.setItem('tdp_viewer_volume', String(val));
    } catch (_) {
      // Ignora
    }
  }

  function ensurePeerJsLoaded() {
    if (typeof window.Peer === 'undefined') {
      showToast('PeerJS ainda não carregou. Verifique sua conexão e tente novamente.', 'error', 4500);
      return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------------
     CONTROLE DE BANDA OBRIGATÓRIO (WebRTC RTCRtpSender.setParameters)
     Aplica maxBitrate na track de vídeo de cada espectador conectado via peer.call()
  ------------------------------------------------------------------------ */
  function enqueueBitrateLimit(viewerRecord, bitrateMbps) {
    if (!viewerRecord || !viewerRecord.mediaCall) return Promise.resolve(false);
    const pc = viewerRecord.mediaCall.peerConnection;
    if (!pc || pc.connectionState === 'closed') return Promise.resolve(false);

    // Serializa chamadas setParameters por espectador para evitar InvalidStateError
    const prev = viewerRecord.bitrateQueue || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => applyVideoBitrateLimit(pc, bitrateMbps));

    viewerRecord.bitrateQueue = next;
    return next;
  }

  async function applyVideoBitrateLimit(peerConnection, bitrateMbps) {
    if (!peerConnection || peerConnection.connectionState === 'closed') {
      return false;
    }

    const maxBitrateBps = Math.round(Number(bitrateMbps) * 1_000_000);
    const senders = peerConnection.getSenders();
    const videoSender = senders.find(
      (sender) => sender.track && sender.track.kind === 'video'
    );

    if (!videoSender) {
      return false;
    }

    try {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      params.encodings[0].maxBitrate = maxBitrateBps;

      // Tenta manter framerate fluido sob restrição de banda, com fallback seguro
      try {
        params.degradationPreference = 'maintain-framerate';
        await videoSender.setParameters(params);
      } catch (prefErr) {
        delete params.degradationPreference;
        await videoSender.setParameters(params);
      }

      return true;
    } catch (err) {
      console.warn('[BandwidthCap] Falha ao aplicar setParameters(maxBitrate):', err);
      return false;
    }
  }

  function bindBitrateEnforcement(call, viewerRecord) {
    const pc = call.peerConnection;
    if (!pc) return;

    const enforceNow = () => {
      if (state.mode !== 'host' || viewerRecord.mediaCall !== call) return;
      enqueueBitrateLimit(viewerRecord, state.host.bitrateMbps);
    };

    // 1. Aplica imediatamente após peer.call()
    enforceNow();

    // 2. Reforça após negociação SDP e estabelecimento ICE (evita reset por navegador)
    pc.addEventListener('signalingstatechange', () => {
      if (pc.signalingState === 'stable') {
        enforceNow();
      }
    });

    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        enforceNow();
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') {
        enforceNow();
      }
    });

    // 3. Verificação extra rápida para garantir aplicação mesmo em negociação assíncrona
    window.setTimeout(enforceNow, 750);
  }

  function applyBitrateToAllViewers() {
    const tasks = [];
    state.host.viewers.forEach((viewer) => {
      if (viewer.mediaCall && viewer.mediaCall.peerConnection) {
        tasks.push(enqueueBitrateLimit(viewer, state.host.bitrateMbps));
      }
    });
    updateHostBandwidthSummary();
    broadcastHostMessage({
      type: 'stream-config',
      streamConfig: getCurrentStreamConfig()
    });
    return Promise.all(tasks);
  }

  /* ------------------------------------------------------------------------
     MODO HOST: Criação de Sala, Sinalização e Captura de Tela
  ------------------------------------------------------------------------ */
  function createHostRoom(attempt = 1) {
    if (!ensurePeerJsLoaded()) return;

    const mySession = attempt === 1 ? ++state.sessionSeq : state.sessionSeq;
    const maxAttempts = 5;
    const roomId = generateShortRoomId();
    const hostPeerId = `${PEER_HOST_PREFIX}${roomId.toLowerCase()}`;
    const chosenName = (el.inputHostName.value || '').trim() || 'Pedrão';

    el.btnCreateRoom.disabled = true;
    el.btnCreateRoom.querySelector('span').textContent = 'Criando sala...';

    const peer = new window.Peer(hostPeerId, PEER_CONFIG);
    let opened = false;
    const openTimeout = window.setTimeout(() => {
      if (!opened && state.sessionSeq === mySession) {
        el.btnCreateRoom.disabled = false;
        el.btnCreateRoom.querySelector('span').textContent = 'Criar Sala';
        try {
          peer.destroy();
        } catch (_) {}
        showToast('Tempo esgotado ao conectar no PeerJS. Tente novamente.', 'error', 4500);
      }
    }, 12000);

    peer.on('open', () => {
      clearTimeout(openTimeout);
      if (state.sessionSeq !== mySession) {
        peer.destroy();
        return;
      }
      opened = true;
      state.peer = peer;
      state.roomId = roomId;
      state.localName = chosenName;
      state.host.viewers.clear();

      el.btnCreateRoom.disabled = false;
      el.btnCreateRoom.querySelector('span').textContent = 'Criar Sala';

      setupHostUI();
      switchView('host');
      startHostStatsLoop();
      showToast(`Sala ${roomId} criada! Copie o link para convidar.`, 'success');
    });

    peer.on('connection', (conn) => {
      if (state.sessionSeq !== mySession) return;
      handleIncomingViewerDataConn(conn, mySession);
    });

    peer.on('disconnected', () => {
      if (state.sessionSeq === mySession && state.mode === 'host' && !state.isCleaningUp && state.peer && !state.peer.destroyed) {
        showToast('Sinalização oscilou. Reconectando automaticamente...', 'warning');
        window.setTimeout(() => {
          if (state.sessionSeq === mySession && state.peer && !state.peer.destroyed && state.peer.disconnected) {
            state.peer.reconnect();
          }
        }, 1200);
      }
    });

    peer.on('error', (err) => {
      if (state.sessionSeq !== mySession) return;
      clearTimeout(openTimeout);
      console.error('[Host PeerJS]', err);

      if (!opened && err.type === 'unavailable-id' && attempt < maxAttempts) {
        peer.destroy();
        createHostRoom(attempt + 1);
        return;
      }

      if (!opened) {
        el.btnCreateRoom.disabled = false;
        el.btnCreateRoom.querySelector('span').textContent = 'Criar Sala';
        peer.destroy();
        showToast('Erro ao criar sala no servidor PeerJS. Tente novamente.', 'error', 4500);
        return;
      }

      if (err.type === 'network' || err.type === 'server-error') {
        showToast('Falha temporária de conexão com o servidor de sinalização.', 'warning');
      }
    });
  }

  function setupHostUI() {
    const shareUrl = buildShareUrl(state.roomId);
    el.hostRoomIdText.textContent = state.roomId;
    el.btnCopyRoomId.setAttribute('aria-label', `Copiar código da sala ${state.roomId}`);
    el.hostDirectLinkText.textContent = shareUrl;

    updateBitrateSliderUI();
    updateHostStreamingUI();
    renderHostParticipants();
    updateHostBandwidthSummary();
  }

  function getCurrentStreamConfig() {
    const res = RESOLUTIONS[state.host.resolution];
    const hasAudio = Boolean(state.host.stream && state.host.stream.getAudioTracks().length > 0);
    return {
      resolution: state.host.resolution,
      width: res.width,
      height: res.height,
      fps: state.host.fps,
      maxBitrate: state.host.bitrateMbps,
      hasAudio
    };
  }

  function getParticipantsSnapshot() {
    const list = [
      {
        id: state.peer ? state.peer.id : 'host',
        name: state.localName,
        role: 'host',
        isStreaming: Boolean(state.host.stream)
      }
    ];
    state.host.viewers.forEach((viewer) => {
      list.push({
        id: viewer.id,
        name: viewer.name,
        role: 'viewer',
        joinedAt: viewer.joinedAt
      });
    });
    return list;
  }

  function broadcastHostMessage(payload) {
    state.host.viewers.forEach((viewer) => {
      if (viewer.dataConn && viewer.dataConn.open) {
        try {
          viewer.dataConn.send(payload);
        } catch (err) {
          console.warn('[Host] Erro ao enviar mensagem para viewer:', viewer.id, err);
        }
      }
    });
  }

  function broadcastParticipants() {
    const participants = getParticipantsSnapshot();
    broadcastHostMessage({ type: 'participants', participants });
    renderHostParticipants();
    updateHostBandwidthSummary();
  }

  function handleIncomingViewerDataConn(conn, mySession) {
    const viewerId = conn.peer;

    conn.on('open', () => {
      if (state.sessionSeq !== mySession || state.mode !== 'host') return;
      // Verifica limite máximo de 6 espectadores simultâneos
      if (!state.host.viewers.has(viewerId) && state.host.viewers.size >= MAX_VIEWERS) {
        try {
          conn.send({ type: 'room-full', maxViewers: MAX_VIEWERS });
        } catch (_) {}
        window.setTimeout(() => conn.close(), 250);
        showToast('Um espectador tentou entrar, mas a sala está cheia (6/6).', 'warning');
        return;
      }

      const rawName = conn.metadata && typeof conn.metadata.name === 'string' ? conn.metadata.name.trim() : '';
      const fallbackNum = state.host.viewers.size + 1;
      const viewerName = rawName.slice(0, 24) || `Espectador ${fallbackNum}`;

      const viewerRecord = {
        id: viewerId,
        name: viewerName,
        joinedAt: Date.now(),
        dataConn: conn,
        mediaCall: null,
        rttMs: null,
        outboundMbps: 0,
        prevBytesSent: 0,
        prevStatsTs: 0,
        bitrateQueue: Promise.resolve()
      };

      state.host.viewers.set(viewerId, viewerRecord);

      // Envia boas-vindas com o estado atual da sala
      conn.send({
        type: 'welcome',
        roomId: state.roomId,
        hostName: state.localName,
        isStreaming: Boolean(state.host.stream),
        streamConfig: getCurrentStreamConfig(),
        participants: getParticipantsSnapshot()
      });

      broadcastParticipants();
      showToast(`${viewerName} entrou na sala.`, 'info');

      // Se já estiver transmitindo, inicia peer.call() imediatamente com limite de bitrate
      if (state.host.stream) {
        callViewerWithStream(viewerRecord);
      }
    });

    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      const viewer = state.host.viewers.get(viewerId);
      if (!viewer) return;

      switch (msg.type) {
        case 'join': {
          if (typeof msg.name === 'string' && msg.name.trim()) {
            viewer.name = msg.name.trim().slice(0, 24);
            broadcastParticipants();
          }
          break;
        }
        case 'ping': {
          if (conn.open) {
            conn.send({ type: 'pong', ts: msg.ts });
          }
          break;
        }
        case 'request-stream': {
          if (state.host.stream) {
            callViewerWithStream(viewer);
          }
          break;
        }
        default:
          break;
      }
    });

    conn.on('close', () => {
      if (state.sessionSeq !== mySession) return;
      removeViewer(viewerId, true);
    });

    conn.on('error', (err) => {
      if (state.sessionSeq !== mySession) return;
      console.warn('[Host DataConn]', viewerId, err);
      removeViewer(viewerId, false);
    });
  }

  function callViewerWithStream(viewerRecord) {
    if (!state.peer || !state.host.stream || !viewerRecord) return;

    // Fecha chamada anterior se existir
    if (viewerRecord.mediaCall) {
      try {
        viewerRecord.mediaCall.close();
      } catch (_) {}
      viewerRecord.mediaCall = null;
    }

    viewerRecord.prevBytesSent = 0;
    viewerRecord.prevStatsTs = 0;
    viewerRecord.outboundMbps = 0;

    // Chama o espectador enviando o MediaStream da tela
    const call = state.peer.call(viewerRecord.id, state.host.stream, {
      metadata: {
        roomId: state.roomId,
        streamConfig: getCurrentStreamConfig()
      }
    });

    if (!call) return;
    viewerRecord.mediaCall = call;

    // Controle de banda obrigatório logo após peer.call()
    bindBitrateEnforcement(call, viewerRecord);

    call.on('close', () => {
      if (viewerRecord.mediaCall === call) {
        viewerRecord.mediaCall = null;
        viewerRecord.outboundMbps = 0;
        renderHostParticipants();
        updateHostBandwidthSummary();
      }
    });

    call.on('error', (err) => {
      console.warn('[Host MediaCall]', viewerRecord.id, err);
    });
  }

  function removeViewer(viewerId, notifyToast) {
    const viewer = state.host.viewers.get(viewerId);
    if (!viewer) return;

    if (viewer.mediaCall) {
      try {
        viewer.mediaCall.close();
      } catch (_) {}
    }

    state.host.viewers.delete(viewerId);
    broadcastParticipants();

    if (notifyToast && state.mode === 'host' && !state.isCleaningUp) {
      showToast(`${viewer.name} saiu da sala.`, 'info', 2500);
    }
  }

  function kickViewer(viewerId) {
    const viewer = state.host.viewers.get(viewerId);
    if (!viewer) return;

    if (viewer.dataConn && viewer.dataConn.open) {
      try {
        viewer.dataConn.send({ type: 'kicked', reason: 'Removido pelo Host.' });
      } catch (_) {}
      window.setTimeout(() => {
        try {
          viewer.dataConn.close();
        } catch (_) {}
      }, 150);
    }

    removeViewer(viewerId, false);
    showToast(`${viewer.name} foi removido da sala.`, 'warning');
  }

  /* ------------------------------------------------------------------------
     HOST: Captura de Tela via navigator.mediaDevices.getDisplayMedia
  ------------------------------------------------------------------------ */
  function buildDisplayMediaConstraints(relaxed = false) {
    if (relaxed) {
      return {
        video: true,
        audio: state.host.captureAudio
      };
    }

    const res = RESOLUTIONS[state.host.resolution];
    const fps = state.host.fps;

    const constraints = {
      video: {
        width: { ideal: res.width },
        height: { ideal: res.height },
        frameRate: { ideal: fps }
      },
      audio: state.host.captureAudio
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        : false
    };

    if (state.host.captureAudio) {
      constraints.systemAudio = 'include';
    }

    return constraints;
  }

  async function startScreenCapture(isSwitchingSource = false) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showToast(
        'Seu navegador não suporta captura de tela (ou a página não está em HTTPS/localhost).',
        'error',
        5000
      );
      return;
    }

    const mySession = state.sessionSeq;
    let newStream;
    try {
      newStream = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaConstraints(false));
    } catch (err) {
      if (err && (err.name === 'OverconstrainedError' || err.name === 'TypeError')) {
        try {
          newStream = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaConstraints(true));
        } catch (fallbackErr) {
          err = fallbackErr;
        }
      }

      if (!newStream) {
        if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
          if (!isSwitchingSource) {
            showToast('Captura de tela cancelada.', 'info', 2200);
          }
        } else {
          console.error('[getDisplayMedia]', err);
          showToast('Não foi possível iniciar a captura de tela.', 'error', 4000);
        }
        return;
      }
    }

    if (state.mode !== 'host' || state.sessionSeq !== mySession) {
      newStream.getTracks().forEach((t) => t.stop());
      return;
    }

    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) {
      newStream.getTracks().forEach((t) => t.stop());
      showToast('Nenhuma track de vídeo foi capturada.', 'error');
      return;
    }

    // Dica de conteúdo para codificador WebRTC (fluidez em 60 FPS)
    if ('contentHint' in newVideoTrack) {
      newVideoTrack.contentHint = state.host.fps >= 60 ? 'motion' : 'detail';
    }

    const oldStream = state.host.stream;
    const oldHadAudio = Boolean(oldStream && oldStream.getAudioTracks().length > 0);
    const newHasAudio = newStream.getAudioTracks().length > 0;

    // Quando o usuário clicar em "Parar compartilhamento" na barra nativa do navegador
    newVideoTrack.addEventListener('ended', () => {
      if (state.host.stream === newStream) {
        stopScreenCapture(true);
      }
    });

    state.host.stream = newStream;
    el.hostPreviewVideo.srcObject = newStream;
    el.hostPreviewVideo.play().catch(() => {});

    if (!isSwitchingSource || !state.host.startedAt) {
      state.host.startedAt = Date.now();
      startHostUptimeTimer();
    }

    // Atualiza ou inicia chamadas WebRTC para todos os espectadores na sala
    if (isSwitchingSource && oldStream && oldHadAudio === newHasAudio) {
      // Troca suave sem derrubar a conexão P2P (replaceTrack + reaplica maxBitrate)
      const newAudioTrack = newStream.getAudioTracks()[0] || null;
      const replaceJobs = [];

      state.host.viewers.forEach((viewer) => {
        if (viewer.mediaCall && viewer.mediaCall.peerConnection) {
          const pc = viewer.mediaCall.peerConnection;
          const senders = pc.getSenders();
          const vSender = senders.find((s) => s.track && s.track.kind === 'video');
          const aSender = senders.find((s) => s.track && s.track.kind === 'audio');

          if (vSender) {
            replaceJobs.push(
              vSender
                .replaceTrack(newVideoTrack)
                .then(() => enqueueBitrateLimit(viewer, state.host.bitrateMbps))
                .catch(() => callViewerWithStream(viewer))
            );
          } else {
            callViewerWithStream(viewer);
          }

          if (aSender && newAudioTrack) {
            aSender.replaceTrack(newAudioTrack).catch(() => {});
          }
        } else {
          callViewerWithStream(viewer);
        }
      });

      await Promise.all(replaceJobs);
    } else {
      state.host.viewers.forEach((viewer) => {
        callViewerWithStream(viewer);
      });
    }

    // Encerra tracks antigos após a troca
    if (oldStream && oldStream !== newStream) {
      oldStream.getTracks().forEach((track) => track.stop());
    }

    updateHostStreamingUI();
    updateActualCaptureBadge();
    broadcastHostMessage({
      type: 'stream-started',
      streamConfig: getCurrentStreamConfig()
    });
    broadcastParticipants();

    if (state.host.captureAudio && !newHasAudio) {
      showToast(
        'Tela transmitindo sem áudio. Para som do sistema, marque "Compartilhar áudio" na janela do navegador.',
        'warning',
        5000
      );
    } else {
      showToast(
        isSwitchingSource ? 'Fonte de tela alterada com sucesso!' : 'Transmissão iniciada ao vivo!',
        'success'
      );
    }
  }

  function stopScreenCapture(fromBrowserBar = false) {
    const stream = state.host.stream;
    state.host.stream = null;
    state.host.startedAt = null;
    state.host.previewHidden = false;

    if (state.host.uptimeTimer) {
      clearInterval(state.host.uptimeTimer);
      state.host.uptimeTimer = null;
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    el.hostPreviewVideo.srcObject = null;

    // Fecha todas as MediaConnections mantendo os espectadores na sala via DataConnection
    state.host.viewers.forEach((viewer) => {
      if (viewer.mediaCall) {
        try {
          viewer.mediaCall.close();
        } catch (_) {}
        viewer.mediaCall = null;
      }
      viewer.outboundMbps = 0;
      viewer.prevBytesSent = 0;
      viewer.prevStatsTs = 0;
    });

    broadcastHostMessage({ type: 'stream-stopped' });
    updateHostStreamingUI();
    broadcastParticipants();
    updateHostBandwidthSummary();

    if (!state.isCleaningUp) {
      showToast(
        fromBrowserBar ? 'Compartilhamento encerrado pelo navegador.' : 'Transmissão pausada.',
        'info'
      );
    }
  }

  async function applyLiveTrackConstraints() {
    if (!state.host.stream) return;
    const videoTrack = state.host.stream.getVideoTracks()[0];
    if (!videoTrack) return;

    const res = RESOLUTIONS[state.host.resolution];
    const fps = state.host.fps;

    if ('contentHint' in videoTrack) {
      videoTrack.contentHint = fps >= 60 ? 'motion' : 'detail';
    }

    try {
      await videoTrack.applyConstraints({
        width: { ideal: res.width, max: res.width },
        height: { ideal: res.height, max: res.height },
        frameRate: { ideal: fps, max: fps }
      });
      updateActualCaptureBadge();
      broadcastHostMessage({
        type: 'stream-config',
        streamConfig: getCurrentStreamConfig()
      });
      showToast(`Captura ajustada para ${state.host.resolution} @ ${fps} FPS.`, 'success', 2400);
    } catch (err) {
      console.warn('[applyConstraints]', err);
      showToast('Ajuste salvo. Use "Trocar Tela" se a fonte atual limitar a alteração.', 'warning', 3200);
    }
  }

  function updateActualCaptureBadge() {
    if (!state.host.stream) return;
    const videoTrack = state.host.stream.getVideoTracks()[0];
    const hasAudio = state.host.stream.getAudioTracks().length > 0;
    const settings = videoTrack && videoTrack.getSettings ? videoTrack.getSettings() : {};

    const w = settings.width || RESOLUTIONS[state.host.resolution].width;
    const h = settings.height || RESOLUTIONS[state.host.resolution].height;
    const fps = settings.frameRate ? Math.round(settings.frameRate) : state.host.fps;

    el.hostActualSpec.textContent = `${w}×${h} • ${fps} FPS`;
    el.hostAudioChip.textContent = hasAudio ? 'Áudio do sistema ativo' : 'Sem áudio';
    el.hostAudioChip.className = `hud-chip ${hasAudio ? 'audio-on' : 'audio-off'}`;
  }

  function startHostUptimeTimer() {
    if (state.host.uptimeTimer) clearInterval(state.host.uptimeTimer);
    el.hostUptime.textContent = '00:00';
    state.host.uptimeTimer = window.setInterval(() => {
      if (!state.host.startedAt) return;
      el.hostUptime.textContent = formatDuration(Date.now() - state.host.startedAt);
    }, 1000);
  }

  function startHostStatsLoop() {
    if (state.host.statsTimer) clearInterval(state.host.statsTimer);
    state.host.statsTimer = window.setInterval(pollHostWebRtcStats, 1500);
  }

  async function pollHostWebRtcStats() {
    if (state.mode !== 'host') return;
    let totalOutboundMbps = 0;
    let updatedAny = false;

    const jobs = [];
    state.host.viewers.forEach((viewer) => {
      const pc = viewer.mediaCall && viewer.mediaCall.peerConnection;
      if (!pc || pc.connectionState === 'closed') {
        viewer.outboundMbps = 0;
        return;
      }

      jobs.push(
        pc.getStats().then((report) => {
          let bytesSent = 0;
          let ts = 0;
          let rttMs = null;

          report.forEach((stat) => {
            if (stat.type === 'outbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video')) {
              bytesSent += stat.bytesSent || 0;
              ts = Math.max(ts, stat.timestamp || 0);
            }
            if (
              stat.type === 'candidate-pair' &&
              (stat.nominated || stat.selected || stat.state === 'succeeded') &&
              typeof stat.currentRoundTripTime === 'number'
            ) {
              rttMs = Math.round(stat.currentRoundTripTime * 1000);
            }
          });

          if (ts > 0 && viewer.prevStatsTs > 0 && ts > viewer.prevStatsTs) {
            const deltaBytes = Math.max(0, bytesSent - viewer.prevBytesSent);
            const deltaSec = (ts - viewer.prevStatsTs) / 1000;
            viewer.outboundMbps = deltaSec > 0 ? (deltaBytes * 8) / (deltaSec * 1_000_000) : 0;
          }

          viewer.prevBytesSent = bytesSent;
          viewer.prevStatsTs = ts;
          if (rttMs !== null) viewer.rttMs = rttMs;

          totalOutboundMbps += viewer.outboundMbps;
          updatedAny = true;
        }).catch(() => {})
      );
    });

    await Promise.all(jobs);
    el.hostRealUpload.textContent = `${totalOutboundMbps.toFixed(2)} Mbps`;
    if (updatedAny) {
      renderHostParticipants();
    }
  }

  function updateHostStreamingUI() {
    const isLive = Boolean(state.host.stream);

    el.hostLiveBadge.className = `status-pill ${isLive ? 'status-live' : 'status-idle'}`;
    el.hostLiveText.textContent = isLive ? 'AO VIVO' : 'Aguardando captura';
    el.hostUptime.classList.toggle('hidden', !isLive);

    el.hostPreviewEmpty.classList.toggle('hidden', isLive);
    el.hostPreviewVideo.classList.toggle('hidden', !isLive || state.host.previewHidden);
    el.hostPreviewPausedUi.classList.toggle('hidden', !isLive || !state.host.previewHidden);
    el.hostPreviewHud.classList.toggle('hidden', !isLive || state.host.previewHidden);

    el.btnSwitchSource.classList.toggle('hidden', !isLive);
    el.btnTogglePreview.classList.toggle('hidden', !isLive);
    el.btnTogglePreviewLabel.textContent = state.host.previewHidden ? 'Mostrar Preview' : 'Ocultar Preview';

    if (isLive) {
      el.btnToggleShare.classList.remove('btn-primary');
      el.btnToggleShare.classList.add('btn-danger');
      el.btnToggleShareLabel.textContent = 'Parar Transmissão';
    } else {
      el.btnToggleShare.classList.remove('btn-danger');
      el.btnToggleShare.classList.add('btn-primary');
      el.btnToggleShareLabel.textContent = 'Compartilhar Tela';
    }
  }

  function updateBitrateSliderUI() {
    const val = state.host.bitrateMbps;
    const min = Number(el.sliderBitrate.min);
    const max = Number(el.sliderBitrate.max);
    const pct = ((val - min) / (max - min)) * 100;

    el.sliderBitrate.value = String(val);
    el.sliderBitrate.style.setProperty('--slider-pct', `${pct.toFixed(1)}%`);
    el.bitrateValueBadge.textContent = `${val.toFixed(1)} Mbps`;
    el.bitrateMax6Estimate.textContent = `${(val * MAX_VIEWERS).toFixed(1)} Mbps upload`;
    updateHostBandwidthSummary();
  }

  function updateHostBandwidthSummary() {
    const count = state.host.viewers.size;
    el.hostViewerCount.textContent = String(count);
    el.hostRoomCountBadge.textContent = `${count} / ${MAX_VIEWERS}`;

    const activeCap = state.host.stream ? count * state.host.bitrateMbps : 0;
    el.hostCapUpload.textContent = `${activeCap.toFixed(1)} Mbps`;
  }

  function renderHostParticipants() {
    const container = el.hostParticipantsList;
    container.replaceChildren();

    // Card do próprio Host
    container.appendChild(
      createParticipantNode({
        name: state.localName,
        role: 'host',
        isSelf: true,
        metaText: state.host.stream
          ? `Transmitindo • ${state.host.resolution} ${state.host.fps}fps`
          : 'Aguardando captura'
      })
    );

    if (state.host.viewers.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-roster';
      empty.textContent = 'Nenhum espectador ainda. Compartilhe o código ou link direto acima.';
      container.appendChild(empty);
      return;
    }

    state.host.viewers.forEach((viewer) => {
      const parts = [];
      if (state.host.stream) {
        parts.push(`${viewer.outboundMbps.toFixed(2)} / ${state.host.bitrateMbps.toFixed(1)} Mbps`);
      } else {
        parts.push('Conectado na sala');
      }
      if (typeof viewer.rttMs === 'number') {
        parts.push(`${viewer.rttMs} ms`);
      }

      container.appendChild(
        createParticipantNode({
          name: viewer.name,
          role: 'viewer',
          isSelf: false,
          metaText: parts.join(' • '),
          onKick: () => kickViewer(viewer.id)
        })
      );
    });
  }

  /* ------------------------------------------------------------------------
     MODO ESPECTADOR: Conexão P2P, Modo Cinema, Volume, Tela Cheia e Latência
  ------------------------------------------------------------------------ */
  function joinRoomAsViewer(rawRoomInput, rawName) {
    if (!ensurePeerJsLoaded()) return;

    const roomId = extractRoomId(rawRoomInput);
    if (!roomId) {
      showToast('Digite um código de sala válido.', 'warning');
      el.inputRoomId.focus();
      return;
    }

    const viewerName = (rawName || '').trim().slice(0, 24) || 'Espectador';

    // Limpa qualquer estado anterior antes de conectar
    cleanupSession(false);

    const mySession = ++state.sessionSeq;
    state.roomId = roomId;
    state.localName = viewerName;
    state.viewer.hostPeerId = `${PEER_HOST_PREFIX}${roomId.toLowerCase()}`;
    state.viewer.isStreaming = false;
    state.viewer.participants = [];
    state.viewer.lastPingRtt = null;
    state.viewer.lastWebRtcRtt = null;

    // Sincroniza URL ?room=ID para facilitar compartilhamento/refresh
    try {
      const nextUrl = buildShareUrl(roomId);
      window.history.replaceState({}, '', nextUrl);
    } catch (_) {}

    setupViewerUI();
    switchView('viewer');
    setViewerStatus('connecting', 'Conectando...');
    setViewerOverlay(
      true,
      `Entrando na sala ${roomId}...`,
      'Estabelecendo conexão direta P2P com o Host via WebRTC.',
      true,
      false
    );

    const peer = new window.Peer(generateViewerPeerId(), PEER_CONFIG);
    state.peer = peer;

    // Timeout amigável caso o host não responda
    state.viewer.connectionTimeout = window.setTimeout(() => {
      if (
        state.sessionSeq === mySession &&
        state.mode === 'viewer' &&
        (!state.viewer.dataConn || !state.viewer.dataConn.open)
      ) {
        setViewerStatus('error', 'Sem resposta');
        setViewerOverlay(
          true,
          'Não foi possível conectar à sala',
          'Verifique se o código está correto e se o Host está com a sala aberta.',
          false,
          true
        );
      }
    }, 12000);

    peer.on('open', () => {
      if (state.sessionSeq !== mySession) {
        peer.destroy();
        return;
      }
      connectDataChannelToHost(mySession);
    });

    // Recebe o MediaStream enviado pelo Host via peer.call()
    peer.on('call', (call) => {
      if (state.sessionSeq !== mySession) return;
      handleIncomingHostMediaCall(call, mySession);
    });

    peer.on('disconnected', () => {
      if (state.sessionSeq === mySession && state.mode === 'viewer' && !state.isCleaningUp && state.peer && !state.peer.destroyed) {
        window.setTimeout(() => {
          if (state.sessionSeq === mySession && state.peer && !state.peer.destroyed && state.peer.disconnected) {
            state.peer.reconnect();
          }
        }, 1200);
      }
    });

    peer.on('error', (err) => {
      if (state.sessionSeq !== mySession) return;
      console.error('[Viewer PeerJS]', err);
      clearViewerConnectionTimeout();

      if (err.type === 'peer-unavailable') {
        setViewerStatus('error', 'Sala não encontrada');
        setViewerOverlay(
          true,
          `Sala ${roomId} não encontrada`,
          'Confira o código informado ou peça ao Host para criar a sala primeiro.',
          false,
          true
        );
        return;
      }

      if (err.type === 'network' || err.type === 'server-error') {
        setViewerStatus('error', 'Erro de rede');
        setViewerOverlay(
          true,
          'Falha na conexão',
          'Não foi possível alcançar o servidor de sinalização PeerJS.',
          false,
          true
        );
      }
    });
  }

  function clearViewerConnectionTimeout() {
    if (state.viewer.connectionTimeout) {
      clearTimeout(state.viewer.connectionTimeout);
      state.viewer.connectionTimeout = null;
    }
  }

  function connectDataChannelToHost(mySession) {
    if (!state.peer || !state.viewer.hostPeerId) return;

    const conn = state.peer.connect(state.viewer.hostPeerId, {
      reliable: true,
      serialization: 'json',
      metadata: { name: state.localName }
    });

    state.viewer.dataConn = conn;

    conn.on('open', () => {
      if (state.sessionSeq !== mySession) return;
      clearViewerConnectionTimeout();
      conn.send({ type: 'join', name: state.localName });
      startViewerPingLoop();
      startViewerStatsLoop();
    });

    conn.on('data', (msg) => {
      if (state.sessionSeq !== mySession) return;
      if (!msg || typeof msg !== 'object') return;
      handleHostSignalMessage(msg);
    });

    conn.on('close', () => {
      if (state.sessionSeq !== mySession || state.mode !== 'viewer' || state.isCleaningUp) return;
      stopViewerPlayback();
      setViewerStatus('error', 'Desconectado');
      setViewerOverlay(
        true,
        'Conexão encerrada',
        'O Host fechou a sala ou a conexão foi interrompida.',
        false,
        true
      );
      stopViewerTimers();
    });

    conn.on('error', (err) => {
      if (state.sessionSeq !== mySession) return;
      console.warn('[Viewer DataConn]', err);
    });
  }

  function scheduleStreamRequestFallback() {
    const mySession = state.sessionSeq;
    window.setTimeout(() => {
      if (
        state.sessionSeq === mySession &&
        state.mode === 'viewer' &&
        state.viewer.isStreaming &&
        !state.viewer.remoteStream &&
        state.viewer.dataConn &&
        state.viewer.dataConn.open
      ) {
        try {
          state.viewer.dataConn.send({ type: 'request-stream' });
        } catch (_) {}
      }
    }, 2500);
  }

  function handleHostSignalMessage(msg) {
    switch (msg.type) {
      case 'welcome': {
        clearViewerConnectionTimeout();
        state.viewer.isStreaming = Boolean(msg.isStreaming);
        state.viewer.streamConfig = msg.streamConfig || null;
        state.viewer.participants = Array.isArray(msg.participants) ? msg.participants : [];

        renderViewerParticipants();
        updateViewerMetaLabel();

        if (state.viewer.isStreaming) {
          setViewerStatus('connecting', 'Recebendo vídeo...');
          setViewerOverlay(
            true,
            'Conectando ao fluxo de vídeo...',
            'Aguardando quadros da transmissão do Host.',
            true,
            false
          );
          scheduleStreamRequestFallback();
        } else {
          setViewerStatus('connected', 'Na sala');
          setViewerOverlay(
            true,
            'Aguardando o Host iniciar a transmissão',
            `Você está conectado à sala de ${msg.hostName || 'Host'}. O vídeo aparecerá automaticamente assim que a tela for compartilhada.`,
            true,
            false
          );
        }
        break;
      }

      case 'room-full': {
        clearViewerConnectionTimeout();
        setViewerStatus('error', 'Sala cheia');
        setViewerOverlay(
          true,
          `Sala lotada (${msg.maxViewers || MAX_VIEWERS}/${msg.maxViewers || MAX_VIEWERS})`,
          'Esta transmissão atingiu o limite máximo de 6 espectadores simultâneos.',
          false,
          true
        );
        showToast('Sala cheia! Máximo de 6 espectadores simultâneos.', 'warning', 4500);
        break;
      }

      case 'participants': {
        state.viewer.participants = Array.isArray(msg.participants) ? msg.participants : [];
        renderViewerParticipants();
        break;
      }

      case 'stream-started': {
        state.viewer.isStreaming = true;
        state.viewer.streamConfig = msg.streamConfig || null;
        renderViewerParticipants();
        updateViewerMetaLabel();
        if (!state.viewer.remoteStream) {
          setViewerStatus('connecting', 'Iniciando vídeo...');
          setViewerOverlay(
            true,
            'Host iniciou a transmissão!',
            'Sincronizando vídeo em tempo real...',
            true,
            false
          );
          scheduleStreamRequestFallback();
        }
        break;
      }

      case 'stream-config': {
        state.viewer.streamConfig = msg.streamConfig || null;
        updateViewerMetaLabel();
        break;
      }

      case 'stream-stopped': {
        state.viewer.isStreaming = false;
        stopViewerPlayback();
        renderViewerParticipants();
        setViewerStatus('connected', 'Na sala');
        setViewerOverlay(
          true,
          'Transmissão pausada pelo Host',
          'Você continua na sala. O player retomará automaticamente quando o Host compartilhar novamente.',
          true,
          false
        );
        showToast('O Host pausou o compartilhamento de tela.', 'info');
        break;
      }

      case 'pong': {
        if (typeof msg.ts === 'number') {
          const rtt = Math.max(1, Math.round(performance.now() - msg.ts));
          state.viewer.lastPingRtt = rtt;
          updateViewerLatencyUI();
        }
        break;
      }

      case 'kicked': {
        stopViewerPlayback();
        stopViewerTimers();
        setViewerStatus('error', 'Removido');
        setViewerOverlay(
          true,
          'Você foi removido da sala',
          msg.reason || 'O Host encerrou sua conexão.',
          false,
          true
        );
        break;
      }

      case 'room-closed': {
        stopViewerPlayback();
        stopViewerTimers();
        setViewerStatus('error', 'Sala encerrada');
        setViewerOverlay(
          true,
          'A sala foi encerrada pelo Host',
          'Obrigado por assistir! Você pode voltar à tela inicial para entrar em outra sala.',
          false,
          true
        );
        break;
      }

      default:
        break;
    }
  }

  function handleIncomingHostMediaCall(call, mySession) {
    if (state.viewer.mediaCall && state.viewer.mediaCall !== call) {
      try {
        state.viewer.mediaCall.close();
      } catch (_) {}
    }

    state.viewer.mediaCall = call;
    state.viewer.prevBytesRecv = 0;
    state.viewer.prevStatsTs = 0;

    // Responde em modo receive-only (sem enviar mídia do espectador)
    call.answer();

    call.on('stream', (remoteStream) => {
      if (state.sessionSeq !== mySession) return;
      state.viewer.remoteStream = remoteStream;
      state.viewer.isStreaming = true;
      renderViewerParticipants();
      attachRemoteStreamToPlayer(remoteStream);
    });

    call.on('close', () => {
      if (state.sessionSeq !== mySession) return;
      if (state.viewer.mediaCall === call) {
        state.viewer.mediaCall = null;
        if (state.viewer.isStreaming && state.mode === 'viewer' && !state.isCleaningUp) {
          stopViewerPlayback();
          setViewerStatus('connected', 'Na sala');
          setViewerOverlay(
            true,
            'Aguardando o Host retomar a transmissão',
            'Você continua conectado à sala.',
            true,
            false
          );
        }
      }
    });

    call.on('error', (err) => {
      if (state.sessionSeq !== mySession) return;
      console.warn('[Viewer MediaCall]', err);
    });
  }

  function attachRemoteStreamToPlayer(remoteStream) {
    const video = el.viewerVideo;
    video.srcObject = remoteStream;
    applyVolumeToVideo();

    setViewerOverlay(false);
    setViewerStatus('live', 'Ao Vivo');
    el.playerLiveTag.classList.remove('hidden');
    el.btnUnmuteBanner.classList.add('hidden');

    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        // Política de autoplay bloqueou som sem interação prévia: inicia mutado + exibe botão chamativo
        if (err && err.name === 'NotAllowedError') {
          video.muted = true;
          state.viewer.muted = true;
          updateVolumeUI();
          el.btnUnmuteBanner.classList.remove('hidden');
          video.play().catch(() => {});
        }
      });
    }

    scheduleControlsAutoHide();
  }

  function stopViewerPlayback() {
    state.viewer.remoteStream = null;
    state.viewer.lastWebRtcRtt = null;
    el.viewerVideo.srcObject = null;
    el.playerLiveTag.classList.add('hidden');
    el.btnUnmuteBanner.classList.add('hidden');
    el.playerStreamMeta.classList.add('hidden');
    el.viewerStage.classList.remove('controls-hidden');
  }

  function setupViewerUI() {
    el.viewerRoomIdText.textContent = state.roomId;
    el.btnPip.classList.toggle('hidden', !document.pictureInPictureEnabled);

    state.viewer.cinemaExpanded = false;
    state.viewer.statsVisible = false;
    el.viewerLayout.classList.remove('cinema-expanded');
    el.btnToggleCinema.classList.remove('active');
    el.viewerStatsHud.classList.add('hidden');
    el.btnToggleStats.classList.remove('active');

    updateVolumeUI();
    updateViewerLatencyUI();
    renderViewerParticipants();
  }

  function setViewerStatus(kind, label) {
    const classMap = {
      connecting: 'status-connecting',
      connected: 'status-connected',
      live: 'status-live',
      error: 'status-error'
    };
    el.viewerConnStatus.className = `status-pill ${classMap[kind] || 'status-idle'}`;
    el.viewerConnText.textContent = label;
  }

  function setViewerOverlay(visible, title = '', desc = '', showSpinner = false, showActions = false) {
    el.viewerOverlay.classList.toggle('hidden', !visible);
    if (!visible) return;
    el.viewerOverlayTitle.textContent = title;
    el.viewerOverlayDesc.textContent = desc;
    el.viewerSpinner.classList.toggle('hidden', !showSpinner);
    el.viewerOverlayActions.classList.toggle('hidden', !showActions);
  }

  function startViewerPingLoop() {
    if (state.viewer.pingTimer) clearInterval(state.viewer.pingTimer);
    const sendPing = () => {
      if (state.viewer.dataConn && state.viewer.dataConn.open) {
        try {
          state.viewer.dataConn.send({ type: 'ping', ts: performance.now() });
        } catch (_) {}
      }
    };
    sendPing();
    state.viewer.pingTimer = window.setInterval(sendPing, 2000);
  }

  function startViewerStatsLoop() {
    if (state.viewer.statsTimer) clearInterval(state.viewer.statsTimer);
    state.viewer.statsTimer = window.setInterval(pollViewerWebRtcStats, 1500);
  }

  function stopViewerTimers() {
    clearViewerConnectionTimeout();
    if (state.viewer.pingTimer) {
      clearInterval(state.viewer.pingTimer);
      state.viewer.pingTimer = null;
    }
    if (state.viewer.statsTimer) {
      clearInterval(state.viewer.statsTimer);
      state.viewer.statsTimer = null;
    }
    if (state.viewer.controlsHideTimer) {
      clearTimeout(state.viewer.controlsHideTimer);
      state.viewer.controlsHideTimer = null;
    }
  }

  async function pollViewerWebRtcStats() {
    if (state.mode !== 'viewer') return;
    const pc = state.viewer.mediaCall && state.viewer.mediaCall.peerConnection;
    if (!pc || pc.connectionState === 'closed') return;

    try {
      const report = await pc.getStats();
      let bytesReceived = 0;
      let ts = 0;
      let fps = null;
      let width = null;
      let height = null;
      let packetsLost = 0;
      let packetsReceived = 0;
      let rttMs = null;

      report.forEach((stat) => {
        if (stat.type === 'inbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video')) {
          bytesReceived += stat.bytesReceived || 0;
          ts = Math.max(ts, stat.timestamp || 0);
          if (typeof stat.framesPerSecond === 'number') fps = Math.round(stat.framesPerSecond);
          if (typeof stat.frameWidth === 'number' && stat.frameWidth > 0) width = stat.frameWidth;
          if (typeof stat.frameHeight === 'number' && stat.frameHeight > 0) height = stat.frameHeight;
          packetsLost += stat.packetsLost || 0;
          packetsReceived += stat.packetsReceived || 0;
        }
        if (
          stat.type === 'candidate-pair' &&
          (stat.nominated || stat.selected || stat.state === 'succeeded') &&
          typeof stat.currentRoundTripTime === 'number'
        ) {
          rttMs = Math.round(stat.currentRoundTripTime * 1000);
        }
      });

      let bitrateMbps = null;
      if (ts > 0 && state.viewer.prevStatsTs > 0 && ts > state.viewer.prevStatsTs) {
        const deltaBytes = Math.max(0, bytesReceived - state.viewer.prevBytesRecv);
        const deltaSec = (ts - state.viewer.prevStatsTs) / 1000;
        bitrateMbps = deltaSec > 0 ? (deltaBytes * 8) / (deltaSec * 1_000_000) : 0;
      }
      state.viewer.prevBytesRecv = bytesReceived;
      state.viewer.prevStatsTs = ts;

      if (rttMs !== null) {
        state.viewer.lastWebRtcRtt = rttMs;
        updateViewerLatencyUI();
      }

      const displayW = width || el.viewerVideo.videoWidth;
      const displayH = height || el.viewerVideo.videoHeight;
      const lossPct =
        packetsReceived + packetsLost > 0
          ? ((packetsLost / (packetsReceived + packetsLost)) * 100).toFixed(2)
          : '0.00';

      el.statRes.textContent = displayW && displayH ? `${displayW} × ${displayH}` : '--';
      el.statFps.textContent = fps !== null ? `${fps} FPS` : '--';
      el.statBitrate.textContent = bitrateMbps !== null ? `${bitrateMbps.toFixed(2)} Mbps` : '--';
      const bestRtt = getBestViewerRtt();
      el.statRtt.textContent = bestRtt !== null ? `${bestRtt} ms` : '--';
      el.statLoss.textContent = `${lossPct}%`;

      if (displayW && displayH) {
        const metaParts = [`${displayH}p`];
        if (fps !== null) metaParts.push(`${fps} fps`);
        if (bitrateMbps !== null) metaParts.push(`${bitrateMbps.toFixed(1)} Mbps`);
        el.playerStreamMeta.textContent = metaParts.join(' • ');
        el.playerStreamMeta.classList.remove('hidden');
      }
    } catch (_) {
      // Ignora erros transitórios de getStats
    }
  }

  function getBestViewerRtt() {
    if (typeof state.viewer.lastWebRtcRtt === 'number') return state.viewer.lastWebRtcRtt;
    if (typeof state.viewer.lastPingRtt === 'number') return state.viewer.lastPingRtt;
    return null;
  }

  function updateViewerLatencyUI() {
    const rtt = getBestViewerRtt();
    if (rtt === null) {
      el.viewerLatencyValue.textContent = '-- ms';
      el.viewerLatencyPill.className = 'latency-pill latency-unknown';
      return;
    }

    el.viewerLatencyValue.textContent = `${rtt} ms`;
    let cls = 'latency-good';
    if (rtt > 140) cls = 'latency-poor';
    else if (rtt >= 60) cls = 'latency-medium';
    el.viewerLatencyPill.className = `latency-pill ${cls}`;
  }

  function updateViewerMetaLabel() {
    const cfg = state.viewer.streamConfig;
    if (!cfg || !state.viewer.isStreaming) return;
    if (el.playerStreamMeta.classList.contains('hidden')) {
      el.playerStreamMeta.textContent = `${cfg.resolution} • ${cfg.fps} fps • cap ${Number(cfg.maxBitrate).toFixed(1)} Mbps`;
      el.playerStreamMeta.classList.remove('hidden');
    }
  }

  function renderViewerParticipants() {
    const container = el.viewerParticipantsList;
    container.replaceChildren();

    const list = state.viewer.participants;
    const total = list.length;
    el.viewerRoomCountBadge.textContent = `${total} ${total === 1 ? 'pessoa' : 'pessoas'}`;

    if (total === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-roster';
      empty.textContent = 'Carregando participantes...';
      container.appendChild(empty);
      return;
    }

    const myPeerId = state.peer ? state.peer.id : null;
    list.forEach((person) => {
      const isHost = person.role === 'host';
      const isSelf = myPeerId && person.id === myPeerId;
      let meta = 'Assistindo';
      if (isHost) {
        meta = state.viewer.isStreaming ? 'Transmitindo ao vivo' : 'Preparando transmissão';
      }

      container.appendChild(
        createParticipantNode({
          name: person.name,
          role: person.role,
          isSelf,
          metaText: meta
        })
      );
    });
  }

  /* ------------------------------------------------------------------------
     Controles do Player do Espectador (Volume, Cinema, Fullscreen, PiP)
  ------------------------------------------------------------------------ */
  function applyVolumeToVideo() {
    const vol = state.viewer.muted ? 0 : state.viewer.volume / 100;
    el.viewerVideo.volume = Math.min(1, Math.max(0, vol));
    el.viewerVideo.muted = state.viewer.muted || state.viewer.volume === 0;
  }

  function updateVolumeUI() {
    const effectiveVol = state.viewer.muted ? 0 : state.viewer.volume;
    el.sliderVolume.value = String(effectiveVol);
    el.sliderVolume.style.setProperty('--vol-pct', `${effectiveVol}%`);
    el.volumePercent.textContent = `${effectiveVol}%`;

    const isMuted = effectiveVol === 0;
    el.iconVolOn.classList.toggle('hidden', isMuted);
    el.iconVolOff.classList.toggle('hidden', !isMuted);
  }

  function setViewerVolume(percent) {
    const clamped = Math.min(100, Math.max(0, Math.round(Number(percent))));
    state.viewer.volume = clamped;
    state.viewer.muted = clamped === 0;
    if (clamped > 0) {
      state.viewer.lastVolumeBeforeMute = clamped;
      el.btnUnmuteBanner.classList.add('hidden');
    }
    saveVolume(clamped);
    applyVolumeToVideo();
    updateVolumeUI();
  }

  function toggleViewerMute() {
    if (state.viewer.muted || state.viewer.volume === 0) {
      const restore = state.viewer.lastVolumeBeforeMute > 0 ? state.viewer.lastVolumeBeforeMute : 80;
      setViewerVolume(restore);
    } else {
      state.viewer.lastVolumeBeforeMute = state.viewer.volume;
      state.viewer.muted = true;
      applyVolumeToVideo();
      updateVolumeUI();
    }
  }

  function toggleCinemaMode() {
    state.viewer.cinemaExpanded = !state.viewer.cinemaExpanded;
    el.viewerLayout.classList.toggle('cinema-expanded', state.viewer.cinemaExpanded);
    el.btnToggleCinema.classList.toggle('active', state.viewer.cinemaExpanded);
  }

  function toggleFullscreen() {
    const stage = el.viewerStage;
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);

    if (!isFs) {
      if (stage.requestFullscreen) {
        stage.requestFullscreen().catch(() => {});
      } else if (stage.webkitRequestFullscreen) {
        stage.webkitRequestFullscreen();
      } else if (el.viewerVideo.webkitEnterFullscreen) {
        el.viewerVideo.webkitEnterFullscreen();
      }
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }

  function syncFullscreenIcons() {
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    el.iconFsEnter.classList.toggle('hidden', isFs);
    el.iconFsExit.classList.toggle('hidden', !isFs);
  }

  async function togglePictureInPicture() {
    if (!document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (el.viewerVideo.srcObject) {
        await el.viewerVideo.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('[PiP]', err);
    }
  }

  function scheduleControlsAutoHide() {
    if (state.viewer.controlsHideTimer) {
      clearTimeout(state.viewer.controlsHideTimer);
    }
    el.viewerStage.classList.remove('controls-hidden');

    if (state.mode === 'viewer' && state.viewer.remoteStream) {
      state.viewer.controlsHideTimer = window.setTimeout(() => {
        if (state.mode === 'viewer' && state.viewer.remoteStream) {
          el.viewerStage.classList.add('controls-hidden');
        }
      }, 2800);
    }
  }

  /* ------------------------------------------------------------------------
     Helper de Renderização Segura de Participante (sem innerHTML inseguro)
  ------------------------------------------------------------------------ */
  function createParticipantNode({ name, role, isSelf, metaText, onKick }) {
    const item = document.createElement('div');
    item.className = 'participant-item';

    const main = document.createElement('div');
    main.className = 'participant-main';

    const avatar = document.createElement('div');
    avatar.className = `avatar ${role === 'host' ? 'avatar-host' : ''}`;
    avatar.textContent = getInitials(name);

    const info = document.createElement('div');
    info.className = 'participant-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'participant-name-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'participant-name';
    nameEl.textContent = name;
    nameRow.appendChild(nameEl);

    if (role === 'host') {
      const hostTag = document.createElement('span');
      hostTag.className = 'mini-tag mini-tag-host';
      hostTag.textContent = 'Host';
      nameRow.appendChild(hostTag);
    }

    if (isSelf) {
      const selfTag = document.createElement('span');
      selfTag.className = 'mini-tag mini-tag-you';
      selfTag.textContent = 'Você';
      nameRow.appendChild(selfTag);
    }

    const meta = document.createElement('div');
    meta.className = 'participant-meta mono';
    meta.textContent = metaText;

    info.appendChild(nameRow);
    info.appendChild(meta);

    main.appendChild(avatar);
    main.appendChild(info);
    item.appendChild(main);

    if (typeof onKick === 'function') {
      const kickBtn = document.createElement('button');
      kickBtn.type = 'button';
      kickBtn.className = 'btn-kick';
      kickBtn.textContent = 'Remover';
      kickBtn.title = `Remover ${name} da sala`;
      kickBtn.addEventListener('click', onKick);
      item.appendChild(kickBtn);
    }

    return item;
  }

  /* ------------------------------------------------------------------------
     Limpeza Completa da Sessão
  ------------------------------------------------------------------------ */
  function cleanupSession(returnToLanding = true) {
    state.isCleaningUp = true;
    state.sessionSeq += 1;

    if (state.mode === 'host') {
      broadcastHostMessage({ type: 'room-closed' });
      if (state.host.stream) {
        state.host.stream.getTracks().forEach((t) => t.stop());
        state.host.stream = null;
      }
      state.host.startedAt = null;
      state.host.previewHidden = false;
      if (state.host.uptimeTimer) {
        clearInterval(state.host.uptimeTimer);
        state.host.uptimeTimer = null;
      }
      if (state.host.statsTimer) {
        clearInterval(state.host.statsTimer);
        state.host.statsTimer = null;
      }
      state.host.viewers.forEach((viewer) => {
        if (viewer.mediaCall) {
          try { viewer.mediaCall.close(); } catch (_) {}
        }
        if (viewer.dataConn) {
          try { viewer.dataConn.close(); } catch (_) {}
        }
      });
      state.host.viewers.clear();
      el.hostPreviewVideo.srcObject = null;
      el.hostRealUpload.textContent = '0.00 Mbps';
      el.hostCapUpload.textContent = '0.0 Mbps';
    }

    if (state.mode === 'viewer') {
      stopViewerTimers();
      stopViewerPlayback();
      if (state.viewer.mediaCall) {
        try { state.viewer.mediaCall.close(); } catch (_) {}
        state.viewer.mediaCall = null;
      }
      if (state.viewer.dataConn) {
        try { state.viewer.dataConn.close(); } catch (_) {}
        state.viewer.dataConn = null;
      }
      state.viewer.participants = [];
    }

    if (state.peer) {
      try {
        state.peer.destroy();
      } catch (_) {}
      state.peer = null;
    }

    state.roomId = null;
    state.isCleaningUp = false;

    if (returnToLanding) {
      switchView('landing');
    }
  }

  /* ------------------------------------------------------------------------
     Detecção de ?room=ID na URL inicial
  ------------------------------------------------------------------------ */
  function checkInitialRoomParam() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = extractRoomId(params.get('room'));
    if (!roomParam) return;

    el.inputRoomId.value = roomParam;
    el.inviteRoomCode.textContent = roomParam;
    el.inviteBanner.classList.remove('hidden');
    el.cardJoinViewer.classList.add('highlighted');

    // Foco direto no botão de entrar para fluxo de 1 clique com áudio liberado
    window.setTimeout(() => {
      el.btnJoinRoom.focus();
    }, 100);
  }

  function clearInviteQuery() {
    el.inviteBanner.classList.add('hidden');
    el.cardJoinViewer.classList.remove('highlighted');
    el.inputRoomId.value = '';
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    } catch (_) {}
  }

  /* ------------------------------------------------------------------------
     Bind de Eventos da Interface
  ------------------------------------------------------------------------ */
  function bindEvents() {
    // Landing: Criar Sala
    el.formCreateRoom.addEventListener('submit', (e) => {
      e.preventDefault();
      createHostRoom();
    });

    // Landing: Entrar como Espectador
    el.formJoinRoom.addEventListener('submit', (e) => {
      e.preventDefault();
      joinRoomAsViewer(el.inputRoomId.value, el.inputViewerName.value);
    });

    // Normaliza automaticamente caso o usuário cole um link ?room=ID no input
    el.inputRoomId.addEventListener('paste', () => {
      window.setTimeout(() => {
        const extracted = extractRoomId(el.inputRoomId.value);
        if (extracted) el.inputRoomId.value = extracted;
      }, 0);
    });

    el.btnClearInvite.addEventListener('click', clearInviteQuery);

    // Host: Copiar ID e Copiar Link (?room=ID)
    el.btnCopyRoomId.addEventListener('click', () => {
      if (state.roomId) {
        copyToClipboard(state.roomId, `Código ${state.roomId} copiado!`);
      }
    });

    const handleCopyShareLink = () => {
      if (state.roomId) {
        copyToClipboard(buildShareUrl(state.roomId), 'Link direto (?room=ID) copiado!');
      }
    };
    el.btnCopyRoomLink.addEventListener('click', handleCopyShareLink);
    el.btnCopyDirectLinkBar.addEventListener('click', handleCopyShareLink);

    // Host: Compartilhar / Parar / Trocar Tela / Preview
    el.btnStartShareHero.addEventListener('click', () => startScreenCapture(false));

    el.btnToggleShare.addEventListener('click', () => {
      if (state.host.stream) {
        stopScreenCapture(false);
      } else {
        startScreenCapture(false);
      }
    });

    el.btnSwitchSource.addEventListener('click', () => startScreenCapture(true));

    const toggleHostPreview = () => {
      state.host.previewHidden = !state.host.previewHidden;
      updateHostStreamingUI();
    };
    el.btnTogglePreview.addEventListener('click', toggleHostPreview);
    el.btnShowPreviewInline.addEventListener('click', toggleHostPreview);

    el.btnCloseRoom.addEventListener('click', () => {
      cleanupSession(true);
      showToast('Sala encerrada.', 'info');
    });

    // Host: Seletor de Resolução (720p / 1080p)
    el.resolutionButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = btn.dataset.resolution;
        if (!RESOLUTIONS[res] || state.host.resolution === res) return;
        state.host.resolution = res;

        el.resolutionButtons.forEach((b) => {
          const active = b.dataset.resolution === res;
          b.classList.toggle('active', active);
          b.setAttribute('aria-checked', String(active));
        });

        el.labelResolutionDetail.textContent = RESOLUTIONS[res].label;
        applyLiveTrackConstraints();
      });
    });

    // Host: Seletor de FPS (30 / 60)
    el.fpsButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const fps = Number(btn.dataset.fps);
        if ((fps !== 30 && fps !== 60) || state.host.fps === fps) return;
        state.host.fps = fps;

        el.fpsButtons.forEach((b) => {
          const active = Number(b.dataset.fps) === fps;
          b.classList.toggle('active', active);
          b.setAttribute('aria-checked', String(active));
        });

        el.labelFpsDetail.textContent = fps === 60 ? 'Suave para jogos/vídeo' : 'Economiza banda/CPU';
        applyLiveTrackConstraints();
      });
    });

    // Host: Slider de Bitrate Máximo por espectador (1 a 6 Mbps, padrão 2.5 Mbps)
    el.sliderBitrate.addEventListener('input', () => {
      state.host.bitrateMbps = Number(el.sliderBitrate.value);
      updateBitrateSliderUI();

      if (state.host.bitrateDebounce) clearTimeout(state.host.bitrateDebounce);
      state.host.bitrateDebounce = window.setTimeout(() => {
        applyBitrateToAllViewers();
      }, 100);
    });

    el.sliderBitrate.addEventListener('change', () => {
      if (state.host.stream && state.host.viewers.size > 0) {
        showToast(
          `Bitrate máximo aplicado: ${state.host.bitrateMbps.toFixed(1)} Mbps por espectador.`,
          'success',
          2200
        );
      }
    });

    // Host: Checkbox de Capturar áudio do sistema
    el.checkboxSystemAudio.addEventListener('change', () => {
      state.host.captureAudio = el.checkboxSystemAudio.checked;
      if (state.host.stream) {
        showToast('Clique em "Trocar Tela" para aplicar a mudança de áudio do sistema.', 'info', 3500);
      }
    });

    // Viewer: Copiar link, Stats, Cinema, Sair
    el.btnViewerCopyRoom.addEventListener('click', () => {
      if (state.roomId) {
        copyToClipboard(buildShareUrl(state.roomId), `Link da sala ${state.roomId} copiado!`);
      }
    });

    el.btnToggleStats.addEventListener('click', () => {
      state.viewer.statsVisible = !state.viewer.statsVisible;
      el.viewerStatsHud.classList.toggle('hidden', !state.viewer.statsVisible);
      el.btnToggleStats.classList.toggle('active', state.viewer.statsVisible);
    });

    el.btnToggleCinema.addEventListener('click', toggleCinemaMode);
    el.btnStageCinema.addEventListener('click', toggleCinemaMode);

    el.btnLeaveRoom.addEventListener('click', () => {
      cleanupSession(true);
      clearInviteQuery();
    });

    el.btnViewerRetry.addEventListener('click', () => {
      if (state.roomId) {
        joinRoomAsViewer(state.roomId, state.localName);
      }
    });

    el.btnViewerBack.addEventListener('click', () => {
      cleanupSession(true);
      clearInviteQuery();
    });

    // Viewer: Controles do Player (Volume, Mute, Unmute Banner, PiP, Tela Cheia)
    el.btnMute.addEventListener('click', toggleViewerMute);
    el.sliderVolume.addEventListener('input', () => {
      setViewerVolume(el.sliderVolume.value);
    });

    el.btnUnmuteBanner.addEventListener('click', () => {
      const targetVol = state.viewer.volume > 0 ? state.viewer.volume : 100;
      setViewerVolume(targetVol);
      el.btnUnmuteBanner.classList.add('hidden');
      el.viewerVideo.play().catch(() => {});
    });

    el.btnPip.addEventListener('click', togglePictureInPicture);
    el.btnFullscreen.addEventListener('click', toggleFullscreen);
    el.viewerVideo.addEventListener('dblclick', toggleFullscreen);

    document.addEventListener('fullscreenchange', syncFullscreenIcons);
    document.addEventListener('webkitfullscreenchange', syncFullscreenIcons);

    // Auto-ocultação dos controles sobre o palco
    el.viewerStage.addEventListener('mousemove', scheduleControlsAutoHide);
    el.viewerStage.addEventListener('touchstart', scheduleControlsAutoHide, { passive: true });
    el.viewerControls.addEventListener('mouseenter', () => {
      if (state.viewer.controlsHideTimer) clearTimeout(state.viewer.controlsHideTimer);
      el.viewerStage.classList.remove('controls-hidden');
    });
    el.viewerControls.addEventListener('mouseleave', scheduleControlsAutoHide);

    // Atalhos de teclado no modo espectador
    document.addEventListener('keydown', (e) => {
      if (state.mode !== 'viewer') return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (key === 'm') {
        e.preventDefault();
        toggleViewerMute();
      } else if (key === 't') {
        e.preventDefault();
        toggleCinemaMode();
      }
    });

    // Encerramento limpo ao fechar aba
    window.addEventListener('beforeunload', () => {
      if (state.mode === 'host') {
        broadcastHostMessage({ type: 'room-closed' });
      }
      if (state.peer && !state.peer.destroyed) {
        try {
          state.peer.destroy();
        } catch (_) {}
      }
    });
  }

  /* ------------------------------------------------------------------------
     Inicialização
  ------------------------------------------------------------------------ */
  function init() {
    updateBitrateSliderUI();
    updateVolumeUI();
    bindEvents();
    checkInitialRoomParam();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
