/* ==========================================================================
   Transmissão Do Pedrão — Sala P2P Colaborativa (PeerJS + WebRTC Nativo)
   Todos na sala podem transmitir a própria tela e assistir aos outros ao mesmo tempo.
   Arquitetura 100% estática (HTML/CSS/JS puro), pronta para GitHub Pages/Vercel.
========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     Constantes e Configuração WebRTC / PeerJS
  ------------------------------------------------------------------------ */
  const MAX_PARTICIPANTS = 7; // 1 criador + até 6 membros (máx. 6 envios simultâneos por transmissor)
  const MAX_REMOTE_VIEWERS = MAX_PARTICIPANTS - 1;
  const ROOM_ID_LENGTH = 6;
  const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PEER_ROOM_PREFIX = 'tdp-host-';
  const PEER_MEMBER_PREFIX = 'tdp-peer-';

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
    mode: 'landing', // 'landing' | 'room'
    sessionSeq: 0,
    peer: null,
    roomId: null,
    localName: '',
    isOwner: false,
    isCleaningUp: false,

    // Coordenação da Sala
    room: {
      ownerPeerId: null,
      ownerConn: null, // DataConnection (quando membro)
      memberConns: new Map(), // Map<peerId, DataConnection> (quando criador)
      participants: [], // Array<{ id, name, role, joinedAt, isStreaming, streamConfig }>
      connectionTimeout: null,
      pingTimer: null,
      pingRttMs: null
    },

    // Transmissão Local (qualquer participante pode transmitir)
    tx: {
      resolution: '1080p',
      fps: 60,
      bitrateMbps: 2.5,
      degradationPreference: 'maintain-resolution',
      captureAudio: true,
      stream: null,
      previewHidden: false,
      startedAt: null,
      uptimeTimer: null,
      bitrateDebounce: null,
      qualityLimitationReason: 'none',
      // Map<peerId, { peerId, name, call, outboundMbps, rttMs, limitReason, prevBytesSent, prevStatsTs, bitrateQueue }>
      outboundCalls: new Map()
    },

    // Recepção de Telas Remotas (qualquer participante pode assistir)
    rx: {
      // Map<peerId, { peerId, name, call, stream, streamConfig, inboundMbps, rttMs, fps, width, height, lossPct, muted, prevBytesRecv, prevStatsTs }>
      streams: new Map(),
      pendingRequests: new Set()
    },

    // Estado do Player Cinema / Grade
    player: {
      focusKey: null, // null | 'local' | <remotePeerId>
      gridMode: false,
      cinemaExpanded: false,
      statsVisible: false,
      volume: loadSavedVolume(),
      muted: false,
      lastVolumeBeforeMute: 100,
      statsTimer: null,
      controlsHideTimer: null
    }
  };

  /* ------------------------------------------------------------------------
     Cache de Elementos DOM
  ------------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);

  const el = {
    // Views
    viewLanding: $('view-landing'),
    viewRoom: $('view-room'),

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

    // Room Topbar
    roomRoleBadge: $('room-role-badge'),
    btnCopyRoomId: $('btn-copy-room-id'),
    roomIdText: $('room-id-text'),
    btnCopyRoomLink: $('btn-copy-room-link'),
    roomConnStatus: $('room-conn-status'),
    roomConnText: $('room-conn-text'),
    roomLatencyPill: $('room-latency-pill'),
    roomLatencyValue: $('room-latency-value'),
    roomMemberCount: $('room-member-count'),
    btnToggleStats: $('btn-toggle-stats'),
    btnToggleCinema: $('btn-toggle-cinema'),
    btnLeaveRoom: $('btn-leave-room'),

    // Stage & Player
    roomLayout: $('room-layout'),
    playerStage: $('player-stage'),
    mainVideo: $('main-video'),
    multiGrid: $('multi-grid'),
    stageOverlay: $('stage-overlay'),
    stageSpinner: $('stage-spinner'),
    stageIdleIcon: $('stage-idle-icon'),
    stageOverlayTitle: $('stage-overlay-title'),
    stageOverlayDesc: $('stage-overlay-desc'),
    btnStageShare: $('btn-stage-share'),
    btnStageRetry: $('btn-stage-retry'),
    btnStageBack: $('btn-stage-back'),
    btnUnmuteBanner: $('btn-unmute-banner'),
    playerStatsHud: $('player-stats-hud'),
    statSender: $('stat-sender'),
    statCapture: $('stat-capture'),
    statRes: $('stat-res'),
    statFps: $('stat-fps'),
    statBitrate: $('stat-bitrate'),
    statRtt: $('stat-rtt'),
    statLoss: $('stat-loss'),
    statLimit: $('stat-limit'),
    playerControls: $('player-controls'),
    playerLiveTag: $('player-live-tag'),
    playerLiveLabel: $('player-live-label'),
    volumeControlWrap: $('volume-control-wrap'),
    btnMute: $('btn-mute'),
    iconVolOn: $('icon-vol-on'),
    iconVolOff: $('icon-vol-off'),
    sliderVolume: $('slider-volume'),
    volumePercent: $('volume-percent'),
    playerStreamMeta: $('player-stream-meta'),
    btnGridMode: $('btn-grid-mode'),
    btnGridLabel: $('btn-grid-label'),
    btnPip: $('btn-pip'),
    btnStageCinema: $('btn-stage-cinema'),
    btnFullscreen: $('btn-fullscreen'),
    iconFsEnter: $('icon-fs-enter'),
    iconFsExit: $('icon-fs-exit'),

    // Stream Switcher & Direct Link
    streamSwitcher: $('stream-switcher'),
    streamSwitcherList: $('stream-switcher-list'),
    roomDirectLinkText: $('room-direct-link-text'),
    btnCopyDirectLinkBar: $('btn-copy-direct-link-bar'),

    // Broadcast Sidebar Controls
    broadcastStatusBadge: $('broadcast-status-badge'),
    btnToggleShare: $('btn-toggle-share'),
    btnToggleShareLabel: $('btn-toggle-share-label'),
    broadcastSubactions: $('broadcast-subactions'),
    btnSwitchSource: $('btn-switch-source'),
    btnTogglePreview: $('btn-toggle-preview'),
    btnTogglePreviewLabel: $('btn-toggle-preview-label'),
    resolutionButtons: Array.from(document.querySelectorAll('[data-resolution]')),
    fpsButtons: Array.from(document.querySelectorAll('[data-fps]')),
    priorityButtons: Array.from(document.querySelectorAll('[data-priority]')),
    labelResolutionDetail: $('label-resolution-detail'),
    labelFpsDetail: $('label-fps-detail'),
    labelPriorityDetail: $('label-priority-detail'),
    sliderBitrate: $('slider-bitrate'),
    bitrateValueBadge: $('bitrate-value-badge'),
    bitrateMax6Estimate: $('bitrate-max-6-estimate'),
    checkboxSystemAudio: $('checkbox-system-audio'),
    txRealUpload: $('tx-real-upload'),
    txCapUpload: $('tx-cap-upload'),
    txUptime: $('tx-uptime'),

    // Roster
    roomCountBadge: $('room-count-badge'),
    roomParticipantsList: $('room-participants-list'),

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

  function generateMemberPeerId() {
    const rand = Math.random().toString(36).slice(2, 8);
    const ts = Date.now().toString(36).slice(-4);
    return `${PEER_MEMBER_PREFIX}${ts}${rand}`;
  }

  function extractRoomId(rawInput) {
    if (!rawInput) return '';
    const trimmed = String(rawInput).trim();
    if (!trimmed) return '';

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
      // Fallback abaixo
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
      console.error('[Clipboard]', err);
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
    el.viewRoom.classList.toggle('hidden', target !== 'room');
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
    } catch (_) {}
    return 100;
  }

  function saveVolume(val) {
    try {
      localStorage.setItem('tdp_viewer_volume', String(val));
    } catch (_) {}
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
     Aplica maxBitrate na track de vídeo de cada peer conectado via peer.call()
  ------------------------------------------------------------------------ */
  function enqueueBitrateLimit(outboundRecord, bitrateMbps) {
    if (!outboundRecord || !outboundRecord.call) return Promise.resolve(false);
    const pc = outboundRecord.call.peerConnection;
    if (!pc || pc.connectionState === 'closed') return Promise.resolve(false);

    const prev = outboundRecord.bitrateQueue || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => applyVideoBitrateLimit(pc, bitrateMbps));

    outboundRecord.bitrateQueue = next;
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

    if (!videoSender) return false;

    try {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      params.encodings[0].maxBitrate = maxBitrateBps;
      if (state.tx.degradationPreference === 'maintain-resolution') {
        params.encodings[0].scaleResolutionDownBy = 1;
      } else {
        delete params.encodings[0].scaleResolutionDownBy;
      }

      // Aplica preferência de qualidade (padrão: maintain-resolution para manter 720p/1080p nítidos)
      try {
        params.degradationPreference = state.tx.degradationPreference;
        await videoSender.setParameters(params);
      } catch (_) {
        delete params.degradationPreference;
        delete params.encodings[0].scaleResolutionDownBy;
        await videoSender.setParameters(params);
      }

      return true;
    } catch (err) {
      console.warn('[BandwidthCap] Falha ao aplicar setParameters(maxBitrate):', err);
      return false;
    }
  }

  function bindBitrateEnforcement(call, outboundRecord) {
    const pc = call.peerConnection;
    if (!pc) return;

    const enforceNow = () => {
      if (state.mode !== 'room' || outboundRecord.call !== call) return;
      enqueueBitrateLimit(outboundRecord, state.tx.bitrateMbps);
    };

    // 1. Aplica imediatamente após peer.call()
    enforceNow();

    // 2. Reforça após negociação SDP e conexão ICE
    pc.addEventListener('signalingstatechange', () => {
      if (pc.signalingState === 'stable') enforceNow();
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        enforceNow();
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') enforceNow();
    });

    // 3. Garantia extra assíncrona
    window.setTimeout(enforceNow, 750);
  }

  function applyBitrateToAllOutbound() {
    const tasks = [];
    state.tx.outboundCalls.forEach((record) => {
      if (record.call && record.call.peerConnection) {
        tasks.push(enqueueBitrateLimit(record, state.tx.bitrateMbps));
      }
    });
    updateTxBandwidthSummary();
    notifyLocalStreamState();
    return Promise.all(tasks);
  }

  /* ------------------------------------------------------------------------
     CRIAÇÃO DE SALA (CRIADOR / COORDENADOR)
  ------------------------------------------------------------------------ */
  function createRoom(attempt = 1) {
    if (!ensurePeerJsLoaded()) return;

    if (attempt === 1) {
      cleanupSession(false);
    }

    const mySession = attempt === 1 ? ++state.sessionSeq : state.sessionSeq;
    const maxAttempts = 5;
    const roomId = generateShortRoomId();
    const ownerPeerId = `${PEER_ROOM_PREFIX}${roomId.toLowerCase()}`;
    const chosenName = (el.inputHostName.value || '').trim().slice(0, 24) || 'Pedrão';

    el.btnCreateRoom.disabled = true;
    el.btnCreateRoom.querySelector('span').textContent = 'Criando sala...';

    const peer = new window.Peer(ownerPeerId, PEER_CONFIG);
    let opened = false;

    const openTimeout = window.setTimeout(() => {
      if (!opened && state.sessionSeq === mySession) {
        el.btnCreateRoom.disabled = false;
        el.btnCreateRoom.querySelector('span').textContent = 'Criar Sala';
        try { peer.destroy(); } catch (_) {}
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
      state.isOwner = true;
      state.room.ownerPeerId = ownerPeerId;
      state.room.memberConns.clear();
      state.room.participants = [
        {
          id: ownerPeerId,
          name: chosenName,
          role: 'owner',
          joinedAt: Date.now(),
          isStreaming: false,
          streamConfig: null
        }
      ];

      el.btnCreateRoom.disabled = false;
      el.btnCreateRoom.querySelector('span').textContent = 'Criar Sala';

      setupRoomUI();
      switchView('room');
      setRoomStatus('connected', 'Sala aberta');
      startRoomStatsLoop();
      showToast(`Sala ${roomId} criada! Envie o link para seus amigos.`, 'success');
    });

    peer.on('connection', (conn) => {
      if (state.sessionSeq !== mySession || !state.isOwner) return;
      handleOwnerIncomingDataConn(conn, mySession);
    });

    peer.on('call', (call) => {
      if (state.sessionSeq !== mySession) return;
      handleIncomingMediaCall(call, mySession);
    });

    peer.on('disconnected', () => {
      if (state.sessionSeq === mySession && state.mode === 'room' && !state.isCleaningUp && state.peer && !state.peer.destroyed) {
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
      console.error('[Room Owner PeerJS]', err);

      if (!opened && err.type === 'unavailable-id' && attempt < maxAttempts) {
        peer.destroy();
        createRoom(attempt + 1);
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

  /* ------------------------------------------------------------------------
     ENTRADA NA SALA (MEMBRO)
  ------------------------------------------------------------------------ */
  function joinRoom(rawRoomInput, rawName) {
    if (!ensurePeerJsLoaded()) return;

    const roomId = extractRoomId(rawRoomInput);
    if (!roomId) {
      showToast('Digite um código de sala válido.', 'warning');
      el.inputRoomId.focus();
      return;
    }

    const memberName = (rawName || '').trim().slice(0, 24) || 'Amigo';

    cleanupSession(false);

    const mySession = ++state.sessionSeq;
    state.roomId = roomId;
    state.localName = memberName;
    state.isOwner = false;
    state.room.ownerPeerId = `${PEER_ROOM_PREFIX}${roomId.toLowerCase()}`;
    state.room.participants = [];
    state.room.pingRttMs = null;

    try {
      window.history.replaceState({}, '', buildShareUrl(roomId));
    } catch (_) {}

    setupRoomUI();
    switchView('room');
    setRoomStatus('connecting', 'Conectando...');
    setStageOverlay({
      visible: true,
      title: `Entrando na sala ${roomId}...`,
      desc: 'Conectando à sala P2P via WebRTC.',
      showSpinner: true,
      showIdleIcon: false,
      showShareBtn: false,
      showRetryBtn: false,
      showBackBtn: false
    });

    const peer = new window.Peer(generateMemberPeerId(), PEER_CONFIG);
    state.peer = peer;

    state.room.connectionTimeout = window.setTimeout(() => {
      if (
        state.sessionSeq === mySession &&
        state.mode === 'room' &&
        (!state.room.ownerConn || !state.room.ownerConn.open)
      ) {
        setRoomStatus('error', 'Sem resposta');
        setStageOverlay({
          visible: true,
          title: 'Não foi possível conectar à sala',
          desc: 'Verifique se o código está correto e se quem criou a sala ainda está online.',
          showSpinner: false,
          showIdleIcon: false,
          showShareBtn: false,
          showRetryBtn: true,
          showBackBtn: true
        });
      }
    }, 12000);

    peer.on('open', () => {
      if (state.sessionSeq !== mySession) {
        peer.destroy();
        return;
      }
      connectToRoomOwner(mySession);
    });

    peer.on('call', (call) => {
      if (state.sessionSeq !== mySession) return;
      handleIncomingMediaCall(call, mySession);
    });

    peer.on('disconnected', () => {
      if (state.sessionSeq === mySession && state.mode === 'room' && !state.isCleaningUp && state.peer && !state.peer.destroyed) {
        window.setTimeout(() => {
          if (state.sessionSeq === mySession && state.peer && !state.peer.destroyed && state.peer.disconnected) {
            state.peer.reconnect();
          }
        }, 1200);
      }
    });

    peer.on('error', (err) => {
      if (state.sessionSeq !== mySession) return;
      clearRoomConnectionTimeout();
      console.error('[Member PeerJS]', err);

      if (err.type === 'peer-unavailable') {
        setRoomStatus('error', 'Sala não encontrada');
        setStageOverlay({
          visible: true,
          title: `Sala ${roomId} não encontrada`,
          desc: 'Confira o código informado ou peça para o criador abrir a sala primeiro.',
          showSpinner: false,
          showIdleIcon: false,
          showShareBtn: false,
          showRetryBtn: true,
          showBackBtn: true
        });
        return;
      }

      if (err.type === 'network' || err.type === 'server-error') {
        setRoomStatus('error', 'Erro de rede');
        setStageOverlay({
          visible: true,
          title: 'Falha na conexão',
          desc: 'Não foi possível alcançar o servidor de sinalização PeerJS.',
          showSpinner: false,
          showIdleIcon: false,
          showShareBtn: false,
          showRetryBtn: true,
          showBackBtn: true
        });
      }
    });
  }

  function clearRoomConnectionTimeout() {
    if (state.room.connectionTimeout) {
      clearTimeout(state.room.connectionTimeout);
      state.room.connectionTimeout = null;
    }
  }

  function connectToRoomOwner(mySession) {
    if (!state.peer || !state.room.ownerPeerId) return;

    const conn = state.peer.connect(state.room.ownerPeerId, {
      reliable: true,
      serialization: 'json',
      metadata: { name: state.localName }
    });

    state.room.ownerConn = conn;

    conn.on('open', () => {
      if (state.sessionSeq !== mySession) return;
      clearRoomConnectionTimeout();
      conn.send({
        type: 'join',
        name: state.localName,
        isStreaming: Boolean(state.tx.stream),
        streamConfig: state.tx.stream ? getCurrentStreamConfig() : null
      });
      startMemberPingLoop();
      startRoomStatsLoop();
    });

    conn.on('data', (msg) => {
      if (state.sessionSeq !== mySession || !msg || typeof msg !== 'object') return;
      handleMemberSignalMessage(msg);
    });

    conn.on('close', () => {
      if (state.sessionSeq !== mySession || state.mode !== 'room' || state.isCleaningUp) return;
      stopAllRoomMediaOnDisconnect();
      setRoomStatus('error', 'Desconectado');
      setStageOverlay({
        visible: true,
        title: 'Conexão com a sala encerrada',
        desc: 'O criador fechou a sala ou a conexão foi interrompida.',
        showSpinner: false,
        showIdleIcon: false,
        showShareBtn: false,
        showRetryBtn: true,
        showBackBtn: true
      });
    });

    conn.on('error', (err) => {
      if (state.sessionSeq !== mySession) return;
      console.warn('[Member DataConn]', err);
    });
  }

  /* ------------------------------------------------------------------------
     SINALIZAÇÃO DA SALA (CRIADOR <-> MEMBROS)
  ------------------------------------------------------------------------ */
  function handleOwnerIncomingDataConn(conn, mySession) {
    const memberId = conn.peer;

    conn.on('open', () => {
      if (state.sessionSeq !== mySession || state.mode !== 'room' || !state.isOwner) return;

      const alreadyIn = state.room.participants.some((p) => p.id === memberId);
      if (!alreadyIn && state.room.participants.length >= MAX_PARTICIPANTS) {
        try {
          conn.send({ type: 'room-full', maxParticipants: MAX_PARTICIPANTS });
        } catch (_) {}
        window.setTimeout(() => {
          try { conn.close(); } catch (_) {}
        }, 250);
        showToast(`Sala lotada (${MAX_PARTICIPANTS}/${MAX_PARTICIPANTS}).`, 'warning');
        return;
      }

      const rawName = conn.metadata && typeof conn.metadata.name === 'string' ? conn.metadata.name.trim() : '';
      const fallbackNum = state.room.participants.length;
      const memberName = rawName.slice(0, 24) || `Amigo ${fallbackNum}`;

      state.room.memberConns.set(memberId, conn);

      if (!alreadyIn) {
        state.room.participants.push({
          id: memberId,
          name: memberName,
          role: 'member',
          joinedAt: Date.now(),
          isStreaming: false,
          streamConfig: null
        });
      }

      conn.send({
        type: 'welcome',
        roomId: state.roomId,
        participants: state.room.participants
      });

      broadcastParticipantsFromOwner();
      showToast(`${memberName} entrou na sala.`, 'info');
    });

    conn.on('data', (msg) => {
      if (state.sessionSeq !== mySession || !msg || typeof msg !== 'object') return;
      const participant = state.room.participants.find((p) => p.id === memberId);
      if (!participant) return;

      switch (msg.type) {
        case 'join': {
          if (typeof msg.name === 'string' && msg.name.trim()) {
            participant.name = msg.name.trim().slice(0, 24);
          }
          participant.isStreaming = Boolean(msg.isStreaming);
          participant.streamConfig = msg.streamConfig || null;
          broadcastParticipantsFromOwner();
          break;
        }
        case 'stream-state': {
          const wasStreaming = participant.isStreaming;
          participant.isStreaming = Boolean(msg.isStreaming);
          participant.streamConfig = msg.streamConfig || null;
          broadcastParticipantsFromOwner();

          if (!wasStreaming && participant.isStreaming) {
            showToast(`${participant.name} começou a transmitir a tela!`, 'info');
          }
          break;
        }
        case 'relay-request-stream': {
          const targetId = msg.targetId;
          if (!targetId) break;
          if (targetId === state.peer.id) {
            if (state.tx.stream) {
              callParticipantWithLocalStream(participant);
            }
          } else {
            const targetConn = state.room.memberConns.get(targetId);
            if (targetConn && targetConn.open) {
              try {
                targetConn.send({ type: 'request-stream', requesterId: memberId });
              } catch (_) {}
            }
          }
          break;
        }
        case 'ping': {
          if (conn.open) {
            conn.send({ type: 'pong', ts: msg.ts });
          }
          break;
        }
        default:
          break;
      }
    });

    conn.on('close', () => {
      if (state.sessionSeq !== mySession) return;
      removeMemberByOwner(memberId, true);
    });

    conn.on('error', () => {
      if (state.sessionSeq !== mySession) return;
      removeMemberByOwner(memberId, false);
    });
  }

  function broadcastFromOwner(payload) {
    state.room.memberConns.forEach((conn) => {
      if (conn && conn.open) {
        try {
          conn.send(payload);
        } catch (_) {}
      }
    });
  }

  function broadcastParticipantsFromOwner() {
    broadcastFromOwner({
      type: 'participants',
      participants: state.room.participants
    });
    onParticipantsUpdated();
  }

  function removeMemberByOwner(memberId, notifyToast) {
    const idx = state.room.participants.findIndex((p) => p.id === memberId);
    const removed = idx >= 0 ? state.room.participants[idx] : null;
    if (idx >= 0) state.room.participants.splice(idx, 1);
    state.room.memberConns.delete(memberId);

    if (removed) {
      broadcastParticipantsFromOwner();
      if (notifyToast && state.mode === 'room' && !state.isCleaningUp) {
        showToast(`${removed.name} saiu da sala.`, 'info', 2500);
      }
    }
  }

  function kickMember(memberId) {
    if (!state.isOwner) return;
    const conn = state.room.memberConns.get(memberId);
    const participant = state.room.participants.find((p) => p.id === memberId);
    if (!participant) return;

    if (conn && conn.open) {
      try {
        conn.send({ type: 'kicked', reason: 'Removido pelo criador da sala.' });
      } catch (_) {}
      window.setTimeout(() => {
        try { conn.close(); } catch (_) {}
      }, 150);
    }

    removeMemberByOwner(memberId, false);
    showToast(`${participant.name} foi removido da sala.`, 'warning');
  }

  function handleMemberSignalMessage(msg) {
    switch (msg.type) {
      case 'welcome': {
        clearRoomConnectionTimeout();
        state.room.participants = Array.isArray(msg.participants) ? msg.participants : [];
        setRoomStatus('connected', 'Na sala');
        onParticipantsUpdated();
        break;
      }

      case 'room-full': {
        clearRoomConnectionTimeout();
        setRoomStatus('error', 'Sala cheia');
        setStageOverlay({
          visible: true,
          title: `Sala lotada (${msg.maxParticipants || MAX_PARTICIPANTS}/${msg.maxParticipants || MAX_PARTICIPANTS})`,
          desc: 'Esta sala atingiu o limite máximo de participantes.',
          showSpinner: false,
          showIdleIcon: false,
          showShareBtn: false,
          showRetryBtn: true,
          showBackBtn: true
        });
        showToast('Sala cheia!', 'warning', 4500);
        break;
      }

      case 'participants': {
        const prevStreaming = new Set(
          state.room.participants.filter((p) => p.isStreaming).map((p) => p.id)
        );
        state.room.participants = Array.isArray(msg.participants) ? msg.participants : [];

        // Toast amigável quando alguém começa a transmitir
        const myId = state.peer ? state.peer.id : null;
        state.room.participants.forEach((p) => {
          if (p.id !== myId && p.isStreaming && !prevStreaming.has(p.id)) {
            showToast(`${p.name} começou a transmitir a tela!`, 'info');
          }
        });

        onParticipantsUpdated();
        break;
      }

      case 'request-stream': {
        if (state.tx.stream && msg.requesterId) {
          const target = state.room.participants.find((p) => p.id === msg.requesterId);
          if (target) {
            callParticipantWithLocalStream(target);
          }
        }
        break;
      }

      case 'pong': {
        if (typeof msg.ts === 'number') {
          state.room.pingRttMs = Math.max(1, Math.round(performance.now() - msg.ts));
          updateRoomLatencyUI();
        }
        break;
      }

      case 'kicked': {
        stopAllRoomMediaOnDisconnect();
        setRoomStatus('error', 'Removido');
        setStageOverlay({
          visible: true,
          title: 'Você foi removido da sala',
          desc: msg.reason || 'O criador da sala encerrou sua participação.',
          showSpinner: false,
          showIdleIcon: false,
          showShareBtn: false,
          showRetryBtn: false,
          showBackBtn: true
        });
        break;
      }

      case 'room-closed': {
        stopAllRoomMediaOnDisconnect();
        setRoomStatus('error', 'Sala encerrada');
        setStageOverlay({
          visible: true,
          title: 'A sala foi encerrada pelo criador',
          desc: 'Você pode voltar à tela inicial para criar outra sala ou entrar em outra.',
          showSpinner: false,
          showIdleIcon: false,
          showShareBtn: false,
          showRetryBtn: false,
          showBackBtn: true
        });
        break;
      }

      default:
        break;
    }
  }

  function notifyLocalStreamState() {
    if (state.mode !== 'room' || !state.peer) return;
    const isStreaming = Boolean(state.tx.stream);
    const streamConfig = isStreaming ? getCurrentStreamConfig() : null;

    if (state.isOwner) {
      const self = state.room.participants.find((p) => p.id === state.peer.id);
      if (self) {
        self.isStreaming = isStreaming;
        self.streamConfig = streamConfig;
      }
      broadcastParticipantsFromOwner();
    } else if (state.room.ownerConn && state.room.ownerConn.open) {
      try {
        state.room.ownerConn.send({
          type: 'stream-state',
          isStreaming,
          streamConfig
        });
      } catch (_) {}
    }
  }

  /* ------------------------------------------------------------------------
     SINCRONIZAÇÃO DE PARTICIPANTES <-> CHAMADAS P2P (ENVIAR & RECEBER)
  ------------------------------------------------------------------------ */
  function onParticipantsUpdated() {
    if (state.mode !== 'room') return;

    const activeIds = new Set(state.room.participants.map((p) => p.id));
    const myId = state.peer ? state.peer.id : null;

    // 1. Limpa chamadas de saída de quem saiu da sala
    state.tx.outboundCalls.forEach((record, peerId) => {
      if (!activeIds.has(peerId)) {
        if (record.call) {
          try { record.call.close(); } catch (_) {}
        }
        state.tx.outboundCalls.delete(peerId);
      } else {
        const p = state.room.participants.find((x) => x.id === peerId);
        if (p) record.name = p.name;
      }
    });

    // 2. Se estou transmitindo, chama qualquer participante novo na sala
    if (state.tx.stream) {
      syncOutboundCallsWithRoster();
    }

    // 3. Limpa streams recebidos de quem saiu ou parou de transmitir
    let rxChanged = false;
    state.rx.streams.forEach((entry, peerId) => {
      const p = state.room.participants.find((x) => x.id === peerId);
      if (!p || !p.isStreaming) {
        if (entry.call) {
          try { entry.call.close(); } catch (_) {}
        }
        state.rx.streams.delete(peerId);
        if (state.player.focusKey === peerId) {
          state.player.focusKey = null;
        }
        rxChanged = true;
      } else {
        entry.name = p.name;
        entry.streamConfig = p.streamConfig || entry.streamConfig;
      }
    });

    // 4. Se alguém está transmitindo e ainda não recebemos a chamada, agenda pedido de fallback
    state.room.participants.forEach((p) => {
      if (p.id !== myId && p.isStreaming && !state.rx.streams.has(p.id)) {
        scheduleStreamRequest(p.id);
      }
    });

    if (rxChanged) {
      ensureValidFocusKey();
    }

    updateRoomCountersAndBadges();
    updateTxBandwidthSummary();
    renderStreamSwitcher();
    renderParticipantsList();
    syncPlayerStage();
  }

  function scheduleStreamRequest(targetId) {
    if (state.rx.pendingRequests.has(targetId)) return;
    state.rx.pendingRequests.add(targetId);

    const mySession = state.sessionSeq;
    window.setTimeout(() => {
      state.rx.pendingRequests.delete(targetId);
      if (state.sessionSeq !== mySession || state.mode !== 'room') return;

      const stillStreaming = state.room.participants.some(
        (p) => p.id === targetId && p.isStreaming
      );
      if (!stillStreaming || state.rx.streams.has(targetId)) return;

      if (state.isOwner) {
        const conn = state.room.memberConns.get(targetId);
        if (conn && conn.open) {
          try {
            conn.send({ type: 'request-stream', requesterId: state.peer.id });
          } catch (_) {}
        }
      } else if (state.room.ownerConn && state.room.ownerConn.open) {
        try {
          state.room.ownerConn.send({ type: 'relay-request-stream', targetId });
        } catch (_) {}
      }
    }, 2500);
  }

  /* ------------------------------------------------------------------------
     TRANSMISSÃO LOCAL (getDisplayMedia + peer.call + setParameters)
  ------------------------------------------------------------------------ */
  function getCurrentStreamConfig() {
    const res = RESOLUTIONS[state.tx.resolution];
    const videoTrack = state.tx.stream && state.tx.stream.getVideoTracks()[0];
    const settings = videoTrack && videoTrack.getSettings ? videoTrack.getSettings() : {};
    const hasAudio = Boolean(state.tx.stream && state.tx.stream.getAudioTracks().length > 0);
    return {
      resolution: state.tx.resolution,
      width: res.width,
      height: res.height,
      captureWidth: settings.width || null,
      captureHeight: settings.height || null,
      fps: state.tx.fps,
      maxBitrate: state.tx.bitrateMbps,
      degradationPreference: state.tx.degradationPreference,
      qualityLimitationReason: state.tx.qualityLimitationReason || 'none',
      hasAudio
    };
  }

  function buildDisplayMediaConstraints(relaxed = false) {
    if (relaxed) {
      return {
        video: true,
        audio: state.tx.captureAudio
      };
    }

    const res = RESOLUTIONS[state.tx.resolution];
    const fps = state.tx.fps;

    const constraints = {
      video: {
        width: { ideal: res.width },
        height: { ideal: res.height },
        frameRate: { ideal: fps }
      },
      audio: state.tx.captureAudio
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        : false
    };

    if (state.tx.captureAudio) {
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

    if (state.mode !== 'room' || state.sessionSeq !== mySession) {
      newStream.getTracks().forEach((t) => t.stop());
      return;
    }

    const newVideoTrack = newStream.getVideoTracks()[0];
    if (!newVideoTrack) {
      newStream.getTracks().forEach((t) => t.stop());
      showToast('Nenhuma track de vídeo foi capturada.', 'error');
      return;
    }

    if ('contentHint' in newVideoTrack) {
      newVideoTrack.contentHint =
        state.tx.degradationPreference === 'maintain-resolution' ? 'detail' : 'motion';
    }

    const oldStream = state.tx.stream;
    const oldHadAudio = Boolean(oldStream && oldStream.getAudioTracks().length > 0);
    const newHasAudio = newStream.getAudioTracks().length > 0;

    newVideoTrack.addEventListener('ended', () => {
      if (state.tx.stream === newStream) {
        stopScreenCapture(true);
      }
    });

    state.tx.stream = newStream;

    if (!isSwitchingSource || !state.tx.startedAt) {
      state.tx.startedAt = Date.now();
      startTxUptimeTimer();
    }

    if (isSwitchingSource && oldStream && oldHadAudio === newHasAudio) {
      const newAudioTrack = newStream.getAudioTracks()[0] || null;
      const replaceJobs = [];

      state.tx.outboundCalls.forEach((record) => {
        if (record.call && record.call.peerConnection) {
          const pc = record.call.peerConnection;
          const senders = pc.getSenders();
          const vSender = senders.find((s) => s.track && s.track.kind === 'video');
          const aSender = senders.find((s) => s.track && s.track.kind === 'audio');

          if (vSender) {
            replaceJobs.push(
              vSender
                .replaceTrack(newVideoTrack)
                .then(() => enqueueBitrateLimit(record, state.tx.bitrateMbps))
                .catch(() => {
                  const p = state.room.participants.find((x) => x.id === record.peerId);
                  if (p) callParticipantWithLocalStream(p);
                })
            );
          }
          if (aSender && newAudioTrack) {
            aSender.replaceTrack(newAudioTrack).catch(() => {});
          }
        }
      });

      await Promise.all(replaceJobs);
    } else {
      // Reinicia chamadas para todos os outros participantes (ou cria novas)
      state.tx.outboundCalls.forEach((record) => {
        if (record.call) {
          try { record.call.close(); } catch (_) {}
        }
      });
      state.tx.outboundCalls.clear();
      syncOutboundCallsWithRoster();
    }

    if (oldStream && oldStream !== newStream) {
      oldStream.getTracks().forEach((track) => track.stop());
    }

    // Se ainda não há stream remoto focado, mostra o preview local no palco
    if (!state.player.focusKey || state.player.focusKey === 'local') {
      state.player.focusKey = 'local';
    }

    notifyLocalStreamState();
    updateTxControlsUI();
    updateTxBandwidthSummary();
    renderStreamSwitcher();
    renderParticipantsList();
    syncPlayerStage();

    if (state.tx.captureAudio && !newHasAudio) {
      showToast(
        'Tela transmitindo sem áudio. Para som do sistema, marque "Compartilhar áudio" na janela do navegador.',
        'warning',
        5000
      );
    } else {
      showToast(
        isSwitchingSource ? 'Fonte de tela alterada!' : 'Você está transmitindo sua tela!',
        'success'
      );
    }
  }

  function syncOutboundCallsWithRoster() {
    if (!state.tx.stream || !state.peer) return;
    const myId = state.peer.id;

    let sentCount = 0;
    state.room.participants.forEach((participant) => {
      if (participant.id === myId) return;
      if (sentCount >= MAX_REMOTE_VIEWERS) return;
      sentCount += 1;

      if (!state.tx.outboundCalls.has(participant.id)) {
        callParticipantWithLocalStream(participant);
      }
    });
  }

  function callParticipantWithLocalStream(participant) {
    if (!state.peer || !state.tx.stream || !participant || participant.id === state.peer.id) return;

    const existing = state.tx.outboundCalls.get(participant.id);
    if (existing && existing.call) {
      try { existing.call.close(); } catch (_) {}
    }

    const record = {
      peerId: participant.id,
      name: participant.name,
      call: null,
      outboundMbps: 0,
      rttMs: null,
      prevBytesSent: 0,
      prevStatsTs: 0,
      bitrateQueue: Promise.resolve()
    };

    const call = state.peer.call(participant.id, state.tx.stream, {
      metadata: {
        roomId: state.roomId,
        senderName: state.localName,
        streamConfig: getCurrentStreamConfig()
      }
    });

    if (!call) return;
    record.call = call;
    state.tx.outboundCalls.set(participant.id, record);

    // Controle de banda obrigatório logo após peer.call()
    bindBitrateEnforcement(call, record);

    call.on('close', () => {
      if (state.tx.outboundCalls.get(participant.id) === record) {
        state.tx.outboundCalls.delete(participant.id);
        updateTxBandwidthSummary();
      }
    });

    call.on('error', (err) => {
      console.warn('[Outbound MediaCall]', participant.id, err);
    });
  }

  function stopScreenCapture(fromBrowserBar = false) {
    const stream = state.tx.stream;
    state.tx.stream = null;
    state.tx.startedAt = null;
    state.tx.previewHidden = false;
    state.tx.qualityLimitationReason = 'none';

    if (state.tx.uptimeTimer) {
      clearInterval(state.tx.uptimeTimer);
      state.tx.uptimeTimer = null;
    }
    el.txUptime.textContent = '00:00';

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    state.tx.outboundCalls.forEach((record) => {
      if (record.call) {
        try { record.call.close(); } catch (_) {}
      }
    });
    state.tx.outboundCalls.clear();

    if (state.player.focusKey === 'local') {
      state.player.focusKey = null;
      ensureValidFocusKey();
    }

    notifyLocalStreamState();
    updateTxControlsUI();
    updateTxBandwidthSummary();
    renderStreamSwitcher();
    renderParticipantsList();
    syncPlayerStage();

    if (!state.isCleaningUp) {
      showToast(
        fromBrowserBar ? 'Compartilhamento encerrado pelo navegador.' : 'Sua transmissão foi parada.',
        'info'
      );
    }
  }

  async function applyLiveTrackConstraints() {
    if (!state.tx.stream) return;
    const videoTrack = state.tx.stream.getVideoTracks()[0];
    if (!videoTrack) return;

    const res = RESOLUTIONS[state.tx.resolution];
    const fps = state.tx.fps;

    if ('contentHint' in videoTrack) {
      videoTrack.contentHint =
        state.tx.degradationPreference === 'maintain-resolution' ? 'detail' : 'motion';
    }

    try {
      await videoTrack.applyConstraints({
        width: { ideal: res.width },
        height: { ideal: res.height },
        frameRate: { ideal: fps }
      });
      notifyLocalStreamState();
      showToast(`Captura ajustada para ${state.tx.resolution} @ ${fps} FPS.`, 'success', 2400);
    } catch (err) {
      console.warn('[applyConstraints]', err);
      showToast('Ajuste salvo. Use "Trocar Tela" se a fonte atual limitar a alteração.', 'warning', 3200);
    }
  }

  function startTxUptimeTimer() {
    if (state.tx.uptimeTimer) clearInterval(state.tx.uptimeTimer);
    el.txUptime.textContent = '00:00';
    state.tx.uptimeTimer = window.setInterval(() => {
      if (!state.tx.startedAt) return;
      el.txUptime.textContent = formatDuration(Date.now() - state.tx.startedAt);
    }, 1000);
  }

  /* ------------------------------------------------------------------------
     RECEPÇÃO DE CHAMADAS DE VÍDEO DE OUTROS PARTICIPANTES
  ------------------------------------------------------------------------ */
  function handleIncomingMediaCall(call, mySession) {
    const senderId = call.peer;
    const participant = state.room.participants.find((p) => p.id === senderId);
    const senderName =
      (participant && participant.name) ||
      (call.metadata && call.metadata.senderName) ||
      'Participante';

    const prevEntry = state.rx.streams.get(senderId);
    if (prevEntry && prevEntry.call && prevEntry.call !== call) {
      try { prevEntry.call.close(); } catch (_) {}
    }

    const entry = {
      peerId: senderId,
      name: senderName,
      call,
      stream: null,
      streamConfig: (call.metadata && call.metadata.streamConfig) || (participant && participant.streamConfig) || null,
      inboundMbps: null,
      rttMs: null,
      fps: null,
      width: null,
      height: null,
      lossPct: '0.00',
      muted: false,
      prevBytesRecv: 0,
      prevStatsTs: 0
    };

    state.rx.streams.set(senderId, entry);

    // Responde em receive-only (se o usuário local quiser transmitir, ele faz seu próprio peer.call)
    call.answer();

    call.on('stream', (remoteStream) => {
      if (state.sessionSeq !== mySession || state.mode !== 'room') return;
      entry.stream = remoteStream;

      // Auto-foca no stream remoto se o palco ainda não estiver focado em outro stream remoto
      if (!state.player.focusKey || state.player.focusKey === 'local') {
        state.player.focusKey = senderId;
      }

      renderStreamSwitcher();
      renderParticipantsList();
      syncPlayerStage();
    });

    call.on('close', () => {
      if (state.sessionSeq !== mySession) return;
      if (state.rx.streams.get(senderId) === entry) {
        state.rx.streams.delete(senderId);
        if (state.player.focusKey === senderId) {
          state.player.focusKey = null;
          ensureValidFocusKey();
        }
        renderStreamSwitcher();
        renderParticipantsList();
        syncPlayerStage();
      }
    });

    call.on('error', (err) => {
      console.warn('[Inbound MediaCall]', senderId, err);
    });
  }

  /* ------------------------------------------------------------------------
     GERENCIAMENTO DO PALCO (MODO FOCO CINEMA + GRADE MULTI-TELA)
  ------------------------------------------------------------------------ */
  function getActiveStreamsList() {
    const items = [];

    state.rx.streams.forEach((entry) => {
      if (entry.stream) {
        items.push({
          key: entry.peerId,
          isLocal: false,
          name: entry.name,
          stream: entry.stream,
          entry
        });
      }
    });

    if (state.tx.stream) {
      items.push({
        key: 'local',
        isLocal: true,
        name: `${state.localName} (Sua tela)`,
        stream: state.tx.stream,
        entry: null
      });
    }

    return items;
  }

  function ensureValidFocusKey() {
    const active = getActiveStreamsList();
    if (active.length === 0) {
      state.player.focusKey = null;
      return;
    }

    const exists = active.some((item) => item.key === state.player.focusKey);
    if (!exists) {
      // Prefere focar um stream remoto antes do preview local
      const firstRemote = active.find((item) => !item.isLocal);
      state.player.focusKey = firstRemote ? firstRemote.key : active[0].key;
    }
  }

  function selectFocusStream(key) {
    state.player.focusKey = key;
    if (key === 'local' && state.tx.previewHidden) {
      state.tx.previewHidden = false;
      updateTxControlsUI();
    }
    state.player.gridMode = false;
    renderStreamSwitcher();
    renderParticipantsList();
    syncPlayerStage();
  }

  function syncPlayerStage() {
    const active = getActiveStreamsList();
    ensureValidFocusKey();

    if (active.length < 2 && state.player.gridMode) {
      state.player.gridMode = false;
    }

    const showGrid = state.player.gridMode && active.length >= 2;
    el.btnGridMode.classList.toggle('hidden', active.length < 2);
    el.btnGridMode.classList.toggle('active', showGrid);
    el.btnGridLabel.textContent = showGrid ? 'Foco' : 'Grade';

    // Caso 1: Grade multi-tela
    if (showGrid) {
      el.mainVideo.classList.add('hidden');
      el.mainVideo.srcObject = null;
      el.multiGrid.classList.remove('hidden');
      el.playerControls.classList.remove('hidden');
      el.volumeControlWrap.classList.add('hidden');
      el.btnPip.classList.add('hidden');
      el.btnUnmuteBanner.classList.add('hidden');
      el.playerLiveLabel.textContent = `${active.length} TELAS AO VIVO`;
      el.playerStreamMeta.classList.add('hidden');
      setStageOverlay({ visible: false });
      renderMultiGrid(active);
      return;
    }

    el.multiGrid.classList.add('hidden');
    el.multiGrid.replaceChildren();

    const focused = active.find((item) => item.key === state.player.focusKey) || null;

    // Caso 2: Nenhuma tela ativa no palco
    if (!focused) {
      el.mainVideo.classList.add('hidden');
      el.mainVideo.srcObject = null;
      el.playerControls.classList.add('hidden');
      el.btnUnmuteBanner.classList.add('hidden');
      el.playerStreamMeta.classList.add('hidden');
      el.playerStage.classList.remove('controls-hidden');

      if (state.mode === 'room' && (state.isOwner || (state.room.ownerConn && state.room.ownerConn.open))) {
        const someoneElseLoading = state.room.participants.some(
          (p) => state.peer && p.id !== state.peer.id && p.isStreaming
        );
        if (someoneElseLoading) {
          setStageOverlay({
            visible: true,
            title: 'Conectando ao fluxo de vídeo...',
            desc: 'Sincronizando transmissão P2P em tempo real.',
            showSpinner: true,
            showIdleIcon: false,
            showShareBtn: false,
            showRetryBtn: false,
            showBackBtn: false
          });
        } else {
          setStageOverlay({
            visible: true,
            title: 'Ninguém transmitindo ainda',
            desc: 'Qualquer pessoa na sala pode compartilhar a tela agora — ou aguarde alguém iniciar.',
            showSpinner: false,
            showIdleIcon: true,
            showShareBtn: true,
            showRetryBtn: false,
            showBackBtn: false
          });
        }
      }
      return;
    }

    // Caso 3: Preview local oculto pelo usuário para poupar GPU
    if (focused.isLocal && state.tx.previewHidden) {
      el.mainVideo.classList.add('hidden');
      el.mainVideo.srcObject = null;
      el.playerControls.classList.add('hidden');
      el.btnUnmuteBanner.classList.add('hidden');
      setStageOverlay({
        visible: true,
        title: 'Preview local oculto',
        desc: 'Sua tela continua sendo transmitida normalmente para a sala com menor uso de GPU.',
        showSpinner: false,
        showIdleIcon: true,
        showShareBtn: false,
        showRetryBtn: false,
        showBackBtn: false
      });
      return;
    }

    // Caso 4: Exibição em Modo Cinema no vídeo principal
    setStageOverlay({ visible: false });
    el.mainVideo.classList.remove('hidden');
    el.playerControls.classList.remove('hidden');
    el.btnPip.classList.toggle('hidden', !document.pictureInPictureEnabled);

    if (el.mainVideo.srcObject !== focused.stream) {
      el.mainVideo.srcObject = focused.stream;
    }

    if (focused.isLocal) {
      // Preview local SEMPRE mutado para evitar microfonia/eco
      el.mainVideo.muted = true;
      el.volumeControlWrap.classList.add('hidden');
      el.btnUnmuteBanner.classList.add('hidden');
      el.playerLiveLabel.textContent = 'SEU PREVIEW';
      el.mainVideo.play().catch(() => {});
    } else {
      el.volumeControlWrap.classList.remove('hidden');
      applyVolumeToMainVideo();
      el.playerLiveLabel.textContent = `AO VIVO • ${focused.name}`;

      const playPromise = el.mainVideo.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          if (err && err.name === 'NotAllowedError') {
            el.mainVideo.muted = true;
            state.player.muted = true;
            updateVolumeUI();
            el.btnUnmuteBanner.classList.remove('hidden');
            el.mainVideo.play().catch(() => {});
          }
        });
      }
    }

    updateFocusedStatsHUD();
    scheduleControlsAutoHide();
  }

  function renderMultiGrid(activeItems) {
    const grid = el.multiGrid;
    grid.replaceChildren();

    activeItems.forEach((item) => {
      const tile = document.createElement('div');
      tile.className = `grid-tile ${state.player.focusKey === item.key ? 'focused' : ''}`;

      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = item.stream;

      if (item.isLocal) {
        video.muted = true;
      } else {
        video.muted = Boolean(item.entry && item.entry.muted) || state.player.volume === 0;
        video.volume = state.player.volume / 100;
      }

      const bar = document.createElement('div');
      bar.className = 'grid-tile-bar';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.name;

      const actions = document.createElement('div');
      actions.className = 'grid-tile-actions';

      if (!item.isLocal && item.entry) {
        const muteBtn = document.createElement('button');
        muteBtn.type = 'button';
        muteBtn.className = 'grid-tile-btn';
        muteBtn.textContent = item.entry.muted ? 'Mudo' : 'Som';
        muteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          item.entry.muted = !item.entry.muted;
          video.muted = item.entry.muted;
          muteBtn.textContent = item.entry.muted ? 'Mudo' : 'Som';
        });
        actions.appendChild(muteBtn);
      }

      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'grid-tile-btn';
      focusBtn.textContent = 'Expandir';
      focusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectFocusStream(item.key);
      });
      actions.appendChild(focusBtn);

      bar.appendChild(nameSpan);
      bar.appendChild(actions);
      tile.appendChild(video);
      tile.appendChild(bar);

      tile.addEventListener('click', () => selectFocusStream(item.key));
      grid.appendChild(tile);
      video.play().catch(() => {});
    });
  }

  function renderStreamSwitcher() {
    const active = getActiveStreamsList();
    el.streamSwitcher.classList.toggle('hidden', active.length === 0);
    if (active.length === 0) {
      el.streamSwitcherList.replaceChildren();
      return;
    }

    const list = el.streamSwitcherList;
    list.replaceChildren();

    active.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = !state.player.gridMode && state.player.focusKey === item.key;
      btn.className = `stream-chip ${item.isLocal ? 'is-local' : ''} ${isActive ? 'active' : ''}`;

      const dot = document.createElement('span');
      dot.className = 'stream-chip-dot';

      const label = document.createElement('span');
      label.textContent = item.isLocal ? 'Minha Tela (Preview)' : item.name;

      btn.appendChild(dot);
      btn.appendChild(label);

      const cfg = item.isLocal ? getCurrentStreamConfig() : item.entry && item.entry.streamConfig;
      if (cfg) {
        const meta = document.createElement('span');
        meta.className = 'stream-chip-meta mono';
        meta.textContent = `${cfg.resolution} ${cfg.fps}fps`;
        btn.appendChild(meta);
      }

      btn.addEventListener('click', () => selectFocusStream(item.key));
      list.appendChild(btn);
    });
  }

  /* ------------------------------------------------------------------------
     TELEMETRIA WEBRTC (UPLOAD DO TRANSMISSOR + RECEPÇÃO + LATÊNCIA)
  ------------------------------------------------------------------------ */
  function startMemberPingLoop() {
    if (state.room.pingTimer) clearInterval(state.room.pingTimer);
    const sendPing = () => {
      if (state.room.ownerConn && state.room.ownerConn.open) {
        try {
          state.room.ownerConn.send({ type: 'ping', ts: performance.now() });
        } catch (_) {}
      }
    };
    sendPing();
    state.room.pingTimer = window.setInterval(sendPing, 2000);
  }

  function startRoomStatsLoop() {
    if (state.player.statsTimer) clearInterval(state.player.statsTimer);
    state.player.statsTimer = window.setInterval(pollAllWebRtcStats, 1500);
  }

  function stopRoomTimers() {
    clearRoomConnectionTimeout();
    if (state.room.pingTimer) {
      clearInterval(state.room.pingTimer);
      state.room.pingTimer = null;
    }
    if (state.player.statsTimer) {
      clearInterval(state.player.statsTimer);
      state.player.statsTimer = null;
    }
    if (state.player.controlsHideTimer) {
      clearTimeout(state.player.controlsHideTimer);
      state.player.controlsHideTimer = null;
    }
    if (state.tx.uptimeTimer) {
      clearInterval(state.tx.uptimeTimer);
      state.tx.uptimeTimer = null;
    }
  }

  function formatLimitationReason(reason) {
    switch (reason) {
      case 'bandwidth':
        return 'Banda (upload/rede)';
      case 'cpu':
        return 'CPU (codificação)';
      case 'other':
        return 'Outro';
      case 'none':
        return 'Nenhuma';
      default:
        return reason || 'Nenhuma';
    }
  }

  async function pollAllWebRtcStats() {
    if (state.mode !== 'room') return;

    // 1. Estatísticas de upload (para quem está transmitindo)
    let totalOutboundMbps = 0;
    let worstLimitReason = 'none';
    const txJobs = [];

    state.tx.outboundCalls.forEach((record) => {
      const pc = record.call && record.call.peerConnection;
      if (!pc || pc.connectionState === 'closed') {
        record.outboundMbps = 0;
        return;
      }

      txJobs.push(
        pc.getStats().then((report) => {
          let bytesSent = 0;
          let ts = 0;
          let rttMs = null;
          let limitReason = 'none';

          report.forEach((stat) => {
            if (stat.type === 'outbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video')) {
              bytesSent += stat.bytesSent || 0;
              ts = Math.max(ts, stat.timestamp || 0);
              if (stat.qualityLimitationReason && stat.qualityLimitationReason !== 'none') {
                limitReason = stat.qualityLimitationReason;
              }
            }
            if (
              stat.type === 'candidate-pair' &&
              (stat.nominated || stat.selected || stat.state === 'succeeded') &&
              typeof stat.currentRoundTripTime === 'number'
            ) {
              rttMs = Math.round(stat.currentRoundTripTime * 1000);
            }
          });

          if (ts > 0 && record.prevStatsTs > 0 && ts > record.prevStatsTs) {
            const deltaBytes = Math.max(0, bytesSent - record.prevBytesSent);
            const deltaSec = (ts - record.prevStatsTs) / 1000;
            record.outboundMbps = deltaSec > 0 ? (deltaBytes * 8) / (deltaSec * 1_000_000) : 0;
          }
          record.prevBytesSent = bytesSent;
          record.prevStatsTs = ts;
          record.limitReason = limitReason;
          if (limitReason !== 'none' && worstLimitReason === 'none') {
            worstLimitReason = limitReason;
          }
          if (rttMs !== null) record.rttMs = rttMs;
          totalOutboundMbps += record.outboundMbps;
        }).catch(() => {})
      );
    });

    // 2. Estatísticas de recepção (de todas as telas recebidas)
    const rxJobs = [];
    state.rx.streams.forEach((entry) => {
      const pc = entry.call && entry.call.peerConnection;
      if (!pc || pc.connectionState === 'closed') return;

      rxJobs.push(
        pc.getStats().then((report) => {
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

          if (ts > 0 && entry.prevStatsTs > 0 && ts > entry.prevStatsTs) {
            const deltaBytes = Math.max(0, bytesReceived - entry.prevBytesRecv);
            const deltaSec = (ts - entry.prevStatsTs) / 1000;
            entry.inboundMbps = deltaSec > 0 ? (deltaBytes * 8) / (deltaSec * 1_000_000) : 0;
          }

          entry.prevBytesRecv = bytesReceived;
          entry.prevStatsTs = ts;
          if (fps !== null) entry.fps = fps;
          if (width !== null) entry.width = width;
          if (height !== null) entry.height = height;
          if (rttMs !== null) entry.rttMs = rttMs;

          entry.lossPct =
            packetsReceived + packetsLost > 0
              ? ((packetsLost / (packetsReceived + packetsLost)) * 100).toFixed(2)
              : '0.00';
        }).catch(() => {})
      );
    });

    await Promise.all([...txJobs, ...rxJobs]);

    if (state.tx.stream && state.tx.qualityLimitationReason !== worstLimitReason) {
      state.tx.qualityLimitationReason = worstLimitReason;
      notifyLocalStreamState();
    }

    el.txRealUpload.textContent = `${totalOutboundMbps.toFixed(2)} Mbps`;
    updateRoomLatencyUI();
    updateFocusedStatsHUD();
    if (state.tx.outboundCalls.size > 0) {
      renderParticipantsList();
    }
  }

  function getBestRoomRtt() {
    // 1. Se assistindo um stream remoto, prioriza o RTT WebRTC direto até esse transmissor
    if (state.player.focusKey && state.player.focusKey !== 'local') {
      const focused = state.rx.streams.get(state.player.focusKey);
      if (focused && typeof focused.rttMs === 'number') {
        return focused.rttMs;
      }
    }
    // 2. Se transmitindo para alguém, usa média/primeiro RTT outbound
    for (const rec of state.tx.outboundCalls.values()) {
      if (typeof rec.rttMs === 'number') return rec.rttMs;
    }
    // 3. Fallback: ping/pong até o coordenador da sala
    if (typeof state.room.pingRttMs === 'number') return state.room.pingRttMs;
    if (state.isOwner) return 1;
    return null;
  }

  function updateRoomLatencyUI() {
    const rtt = getBestRoomRtt();
    if (rtt === null) {
      el.roomLatencyValue.textContent = '-- ms';
      el.roomLatencyPill.className = 'latency-pill latency-unknown';
      return;
    }

    el.roomLatencyValue.textContent = `${rtt} ms`;
    let cls = 'latency-good';
    if (rtt > 140) cls = 'latency-poor';
    else if (rtt >= 60) cls = 'latency-medium';
    el.roomLatencyPill.className = `latency-pill ${cls}`;
  }

  function updateFocusedStatsHUD() {
    if (!state.player.focusKey) {
      el.playerStreamMeta.classList.add('hidden');
      return;
    }

    if (state.player.focusKey === 'local' && state.tx.stream) {
      const vTrack = state.tx.stream.getVideoTracks()[0];
      const settings = vTrack && vTrack.getSettings ? vTrack.getSettings() : {};
      const w = settings.width || RESOLUTIONS[state.tx.resolution].width;
      const h = settings.height || RESOLUTIONS[state.tx.resolution].height;
      const fps = settings.frameRate ? Math.round(settings.frameRate) : state.tx.fps;

      el.statSender.textContent = `${state.localName} (Você)`;
      el.statCapture.textContent = `${w} × ${h}`;
      el.statRes.textContent = `${w} × ${h}`;
      el.statFps.textContent = `${fps} FPS`;
      el.statBitrate.textContent = `${el.txRealUpload.textContent} (cap ${state.tx.bitrateMbps.toFixed(1)})`;
      const rtt = getBestRoomRtt();
      el.statRtt.textContent = rtt !== null ? `${rtt} ms` : '--';
      el.statLoss.textContent = '0.00%';
      el.statLimit.textContent = formatLimitationReason(state.tx.qualityLimitationReason);

      el.playerStreamMeta.textContent = `${h}p • ${fps} fps • cap ${state.tx.bitrateMbps.toFixed(1)} Mbps`;
      el.playerStreamMeta.classList.remove('hidden');
      return;
    }

    const entry = state.rx.streams.get(state.player.focusKey);
    if (!entry) return;

    const w = entry.width || el.mainVideo.videoWidth;
    const h = entry.height || el.mainVideo.videoHeight;
    const cfg = entry.streamConfig;
    const capW = cfg && cfg.captureWidth;
    const capH = cfg && cfg.captureHeight;

    el.statSender.textContent = entry.name;
    el.statCapture.textContent = capW && capH ? `${capW} × ${capH}` : '--';
    el.statRes.textContent = w && h ? `${w} × ${h}` : '--';
    el.statFps.textContent = entry.fps !== null ? `${entry.fps} FPS` : '--';
    el.statBitrate.textContent = entry.inboundMbps !== null ? `${entry.inboundMbps.toFixed(2)} Mbps` : '--';
    const rtt = typeof entry.rttMs === 'number' ? entry.rttMs : getBestRoomRtt();
    el.statRtt.textContent = rtt !== null ? `${rtt} ms` : '--';
    el.statLoss.textContent = `${entry.lossPct}%`;
    el.statLimit.textContent = formatLimitationReason(cfg && cfg.qualityLimitationReason);

    if (w && h) {
      const parts = [`${h}p`];
      if (entry.fps !== null) parts.push(`${entry.fps} fps`);
      if (entry.inboundMbps !== null) parts.push(`${entry.inboundMbps.toFixed(1)} Mbps`);
      el.playerStreamMeta.textContent = parts.join(' • ');
      el.playerStreamMeta.classList.remove('hidden');
    } else if (entry.streamConfig) {
      el.playerStreamMeta.textContent = `${entry.streamConfig.resolution} • ${entry.streamConfig.fps} fps`;
      el.playerStreamMeta.classList.remove('hidden');
    }
  }

  /* ------------------------------------------------------------------------
     ATUALIZAÇÃO DE UI & CONTROLES
  ------------------------------------------------------------------------ */
  function setupRoomUI() {
    el.roomIdText.textContent = state.roomId;
    el.btnCopyRoomId.setAttribute('aria-label', `Copiar código da sala ${state.roomId}`);
    el.roomDirectLinkText.textContent = buildShareUrl(state.roomId);

    el.roomRoleBadge.textContent = state.isOwner ? 'CRIADOR' : 'MEMBRO';
    el.roomRoleBadge.className = `role-badge ${state.isOwner ? 'role-host' : ''}`;
    el.btnLeaveRoom.textContent = state.isOwner ? 'Encerrar Sala' : 'Sair';

    state.player.cinemaExpanded = false;
    state.player.statsVisible = false;
    state.player.gridMode = false;
    el.roomLayout.classList.remove('cinema-expanded');
    el.btnToggleCinema.classList.remove('active');
    el.playerStatsHud.classList.add('hidden');
    el.btnToggleStats.classList.remove('active');

    updateBitrateSliderUI();
    updateTxControlsUI();
    updateTxBandwidthSummary();
    updateVolumeUI();
    updateRoomLatencyUI();
    updateRoomCountersAndBadges();
    renderParticipantsList();
    syncPlayerStage();
  }

  function setRoomStatus(kind, label) {
    const classMap = {
      connecting: 'status-connecting',
      connected: 'status-connected',
      live: 'status-live',
      error: 'status-error'
    };
    el.roomConnStatus.className = `status-pill ${classMap[kind] || 'status-idle'}`;
    el.roomConnText.textContent = label;
  }

  function setStageOverlay({
    visible,
    title = '',
    desc = '',
    showSpinner = false,
    showIdleIcon = false,
    showShareBtn = false,
    showRetryBtn = false,
    showBackBtn = false
  }) {
    el.stageOverlay.classList.toggle('hidden', !visible);
    if (!visible) return;
    el.stageOverlayTitle.textContent = title;
    el.stageOverlayDesc.textContent = desc;
    el.stageSpinner.classList.toggle('hidden', !showSpinner);
    el.stageIdleIcon.classList.toggle('hidden', !showIdleIcon);
    el.btnStageShare.classList.toggle('hidden', !showShareBtn);
    el.btnStageRetry.classList.toggle('hidden', !showRetryBtn);
    el.btnStageBack.classList.toggle('hidden', !showBackBtn);
  }

  function updateTxControlsUI() {
    const isLive = Boolean(state.tx.stream);

    el.broadcastStatusBadge.textContent = isLive ? 'AO VIVO' : 'Offline';
    el.broadcastStatusBadge.className = `badge-subtle ${isLive ? 'badge-live-pill' : ''}`;

    el.broadcastSubactions.classList.toggle('hidden', !isLive);
    el.btnTogglePreviewLabel.textContent = state.tx.previewHidden ? 'Mostrar Preview' : 'Ocultar Preview';

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
    const val = state.tx.bitrateMbps;
    const min = Number(el.sliderBitrate.min);
    const max = Number(el.sliderBitrate.max);
    const pct = ((val - min) / (max - min)) * 100;

    el.sliderBitrate.value = String(val);
    el.sliderBitrate.style.setProperty('--slider-pct', `${pct.toFixed(1)}%`);
    el.bitrateValueBadge.textContent = `${val.toFixed(1)} Mbps`;
    el.bitrateMax6Estimate.textContent = `${(val * MAX_REMOTE_VIEWERS).toFixed(1)} Mbps upload`;
    updateTxBandwidthSummary();
  }

  function updateTxBandwidthSummary() {
    const activeViewers = state.tx.stream ? state.tx.outboundCalls.size : 0;
    const cap = activeViewers * state.tx.bitrateMbps;
    el.txCapUpload.textContent = `${cap.toFixed(1)} Mbps`;
  }

  function updateRoomCountersAndBadges() {
    const count = state.room.participants.length;
    el.roomMemberCount.textContent = String(count);
    el.roomCountBadge.textContent = `${count} / ${MAX_PARTICIPANTS}`;

    const anyLive = Boolean(state.tx.stream) || Array.from(state.rx.streams.values()).some((e) => e.stream);
    if (anyLive) {
      setRoomStatus('live', 'Ao Vivo');
    } else if (state.isOwner || (state.room.ownerConn && state.room.ownerConn.open)) {
      setRoomStatus('connected', 'Na sala');
    }
  }

  function renderParticipantsList() {
    const container = el.roomParticipantsList;
    container.replaceChildren();

    const list = state.room.participants;
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-roster';
      empty.textContent = 'Conectando participantes...';
      container.appendChild(empty);
      return;
    }

    const myId = state.peer ? state.peer.id : null;

    list.forEach((person) => {
      const isSelf = myId && person.id === myId;
      const isCreator = person.role === 'owner';
      const isLive = isSelf ? Boolean(state.tx.stream) : Boolean(person.isStreaming);
      const outbound = state.tx.outboundCalls.get(person.id);

      const metaParts = [];
      if (isLive) {
        const cfg = isSelf ? getCurrentStreamConfig() : person.streamConfig;
        metaParts.push(cfg ? `Transmitindo ${cfg.resolution} ${cfg.fps}fps` : 'Transmitindo ao vivo');
      } else {
        metaParts.push('Na sala');
      }

      if (!isSelf && outbound && state.tx.stream) {
        metaParts.push(`↑ ${outbound.outboundMbps.toFixed(2)} Mbps`);
        if (typeof outbound.rttMs === 'number') metaParts.push(`${outbound.rttMs} ms`);
      }

      const item = document.createElement('div');
      item.className = 'participant-item';

      const main = document.createElement('div');
      main.className = 'participant-main';

      const avatar = document.createElement('div');
      avatar.className = `avatar ${isCreator ? 'avatar-host' : ''}`;
      avatar.textContent = getInitials(person.name);

      const info = document.createElement('div');
      info.className = 'participant-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'participant-name-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'participant-name';
      nameEl.textContent = person.name;
      nameRow.appendChild(nameEl);

      if (isCreator) {
        const tag = document.createElement('span');
        tag.className = 'mini-tag mini-tag-host';
        tag.textContent = 'Criador';
        nameRow.appendChild(tag);
      }

      if (isSelf) {
        const tag = document.createElement('span');
        tag.className = 'mini-tag mini-tag-you';
        tag.textContent = 'Você';
        nameRow.appendChild(tag);
      }

      const meta = document.createElement('div');
      meta.className = 'participant-meta mono';
      meta.textContent = metaParts.join(' • ');

      info.appendChild(nameRow);
      info.appendChild(meta);
      main.appendChild(avatar);
      main.appendChild(info);
      item.appendChild(main);

      const actions = document.createElement('div');
      actions.className = 'participant-actions';

      // Botão rápido de Assistir / Assistindo para quem estiver ao vivo
      const streamKey = isSelf ? 'local' : person.id;
      const canWatch = isSelf ? Boolean(state.tx.stream) : Boolean(state.rx.streams.get(person.id)?.stream);

      if (canWatch) {
        const watching = !state.player.gridMode && state.player.focusKey === streamKey;
        const watchBtn = document.createElement('button');
        watchBtn.type = 'button';
        watchBtn.className = `btn-watch ${watching ? 'watching' : ''}`;
        watchBtn.textContent = watching ? 'Vendo' : 'Assistir';
        watchBtn.addEventListener('click', () => selectFocusStream(streamKey));
        actions.appendChild(watchBtn);
      }

      if (state.isOwner && !isSelf) {
        const kickBtn = document.createElement('button');
        kickBtn.type = 'button';
        kickBtn.className = 'btn-kick';
        kickBtn.textContent = 'Remover';
        kickBtn.title = `Remover ${person.name} da sala`;
        kickBtn.addEventListener('click', () => kickMember(person.id));
        actions.appendChild(kickBtn);
      }

      if (actions.childNodes.length > 0) {
        item.appendChild(actions);
      }

      container.appendChild(item);
    });
  }

  /* ------------------------------------------------------------------------
     CONTROLES DO PLAYER (VOLUME, MODO CINEMA, TELA CHEIA, PIP)
  ------------------------------------------------------------------------ */
  function applyVolumeToMainVideo() {
    if (state.player.focusKey === 'local') {
      el.mainVideo.muted = true;
      return;
    }
    const vol = state.player.muted ? 0 : state.player.volume / 100;
    el.mainVideo.volume = Math.min(1, Math.max(0, vol));
    el.mainVideo.muted = state.player.muted || state.player.volume === 0;
  }

  function updateVolumeUI() {
    const effectiveVol = state.player.muted ? 0 : state.player.volume;
    el.sliderVolume.value = String(effectiveVol);
    el.sliderVolume.style.setProperty('--vol-pct', `${effectiveVol}%`);
    el.volumePercent.textContent = `${effectiveVol}%`;

    const isMuted = effectiveVol === 0;
    el.iconVolOn.classList.toggle('hidden', isMuted);
    el.iconVolOff.classList.toggle('hidden', !isMuted);
  }

  function setPlayerVolume(percent) {
    const clamped = Math.min(100, Math.max(0, Math.round(Number(percent))));
    state.player.volume = clamped;
    state.player.muted = clamped === 0;
    if (clamped > 0) {
      state.player.lastVolumeBeforeMute = clamped;
      el.btnUnmuteBanner.classList.add('hidden');
    }
    saveVolume(clamped);
    applyVolumeToMainVideo();
    updateVolumeUI();
  }

  function togglePlayerMute() {
    if (state.player.muted || state.player.volume === 0) {
      const restore = state.player.lastVolumeBeforeMute > 0 ? state.player.lastVolumeBeforeMute : 80;
      setPlayerVolume(restore);
    } else {
      state.player.lastVolumeBeforeMute = state.player.volume;
      state.player.muted = true;
      applyVolumeToMainVideo();
      updateVolumeUI();
    }
  }

  function toggleCinemaMode() {
    state.player.cinemaExpanded = !state.player.cinemaExpanded;
    el.roomLayout.classList.toggle('cinema-expanded', state.player.cinemaExpanded);
    el.btnToggleCinema.classList.toggle('active', state.player.cinemaExpanded);
  }

  function toggleFullscreen() {
    const stage = el.playerStage;
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);

    if (!isFs) {
      if (stage.requestFullscreen) {
        stage.requestFullscreen().catch(() => {});
      } else if (stage.webkitRequestFullscreen) {
        stage.webkitRequestFullscreen();
      } else if (el.mainVideo.webkitEnterFullscreen) {
        el.mainVideo.webkitEnterFullscreen();
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
      } else if (el.mainVideo.srcObject) {
        await el.mainVideo.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('[PiP]', err);
    }
  }

  function scheduleControlsAutoHide() {
    if (state.player.controlsHideTimer) {
      clearTimeout(state.player.controlsHideTimer);
    }
    el.playerStage.classList.remove('controls-hidden');

    if (state.mode === 'room' && !state.player.gridMode && state.player.focusKey) {
      state.player.controlsHideTimer = window.setTimeout(() => {
        if (state.mode === 'room' && !state.player.gridMode && state.player.focusKey) {
          el.playerStage.classList.add('controls-hidden');
        }
      }, 2800);
    }
  }

  /* ------------------------------------------------------------------------
     LIMPEZA DE SESSÃO
  ------------------------------------------------------------------------ */
  function stopAllRoomMediaOnDisconnect() {
    stopRoomTimers();

    if (state.tx.stream) {
      state.tx.stream.getTracks().forEach((t) => t.stop());
      state.tx.stream = null;
    }
    state.tx.startedAt = null;
    state.tx.previewHidden = false;
    state.tx.qualityLimitationReason = 'none';
    state.tx.outboundCalls.forEach((rec) => {
      if (rec.call) {
        try { rec.call.close(); } catch (_) {}
      }
    });
    state.tx.outboundCalls.clear();

    state.rx.streams.forEach((entry) => {
      if (entry.call) {
        try { entry.call.close(); } catch (_) {}
      }
    });
    state.rx.streams.clear();
    state.rx.pendingRequests.clear();

    state.player.focusKey = null;
    state.player.gridMode = false;
    el.mainVideo.srcObject = null;
    el.mainVideo.classList.add('hidden');
    el.multiGrid.classList.add('hidden');
    el.multiGrid.replaceChildren();
    el.playerControls.classList.add('hidden');
    el.streamSwitcher.classList.add('hidden');
    el.btnUnmuteBanner.classList.add('hidden');
    el.txUptime.textContent = '00:00';
    el.txRealUpload.textContent = '0.00 Mbps';
    el.txCapUpload.textContent = '0.0 Mbps';
    updateTxControlsUI();
  }

  function cleanupSession(returnToLanding = true) {
    state.isCleaningUp = true;
    state.sessionSeq += 1;

    if (state.mode === 'room') {
      if (state.isOwner) {
        broadcastFromOwner({ type: 'room-closed' });
        state.room.memberConns.forEach((conn) => {
          try { conn.close(); } catch (_) {}
        });
        state.room.memberConns.clear();
      } else if (state.room.ownerConn) {
        try { state.room.ownerConn.close(); } catch (_) {}
        state.room.ownerConn = null;
      }

      stopAllRoomMediaOnDisconnect();
      state.room.participants = [];
      state.room.pingRttMs = null;
    }

    if (state.peer) {
      try { state.peer.destroy(); } catch (_) {}
      state.peer = null;
    }

    state.roomId = null;
    state.isOwner = false;
    state.isCleaningUp = false;

    if (returnToLanding) {
      switchView('landing');
    }
  }

  /* ------------------------------------------------------------------------
     DETECÇÃO DE ?room=ID NA URL INICIAL
  ------------------------------------------------------------------------ */
  function checkInitialRoomParam() {
    const params = new URLSearchParams(window.location.search);
    const roomParam = extractRoomId(params.get('room'));
    if (!roomParam) return;

    el.inputRoomId.value = roomParam;
    el.inviteRoomCode.textContent = roomParam;
    el.inviteBanner.classList.remove('hidden');
    el.cardJoinViewer.classList.add('highlighted');

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
     BIND DE EVENTOS DA INTERFACE
  ------------------------------------------------------------------------ */
  function bindEvents() {
    // Landing: Criar Sala
    el.formCreateRoom.addEventListener('submit', (e) => {
      e.preventDefault();
      createRoom();
    });

    // Landing: Entrar na Sala
    el.formJoinRoom.addEventListener('submit', (e) => {
      e.preventDefault();
      joinRoom(el.inputRoomId.value, el.inputViewerName.value);
    });

    el.inputRoomId.addEventListener('paste', () => {
      window.setTimeout(() => {
        const extracted = extractRoomId(el.inputRoomId.value);
        if (extracted) el.inputRoomId.value = extracted;
      }, 0);
    });

    el.btnClearInvite.addEventListener('click', clearInviteQuery);

    // Topbar: Copiar ID & Link (?room=ID)
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

    // Topbar: Stats, Cinema, Sair
    el.btnToggleStats.addEventListener('click', () => {
      state.player.statsVisible = !state.player.statsVisible;
      el.playerStatsHud.classList.toggle('hidden', !state.player.statsVisible);
      el.btnToggleStats.classList.toggle('active', state.player.statsVisible);
    });

    el.btnToggleCinema.addEventListener('click', toggleCinemaMode);
    el.btnStageCinema.addEventListener('click', toggleCinemaMode);

    el.btnLeaveRoom.addEventListener('click', () => {
      const wasOwner = state.isOwner;
      cleanupSession(true);
      clearInviteQuery();
      showToast(wasOwner ? 'Sala encerrada.' : 'Você saiu da sala.', 'info');
    });

    // Overlay actions
    el.btnStageShare.addEventListener('click', () => startScreenCapture(false));
    el.btnStageRetry.addEventListener('click', () => {
      if (state.roomId) joinRoom(state.roomId, state.localName);
    });
    el.btnStageBack.addEventListener('click', () => {
      cleanupSession(true);
      clearInviteQuery();
    });

    // Transmissão: Compartilhar / Parar / Trocar Tela / Ocultar Preview
    el.btnToggleShare.addEventListener('click', () => {
      if (state.tx.stream) {
        stopScreenCapture(false);
      } else {
        startScreenCapture(false);
      }
    });

    el.btnSwitchSource.addEventListener('click', () => startScreenCapture(true));

    el.btnTogglePreview.addEventListener('click', () => {
      state.tx.previewHidden = !state.tx.previewHidden;
      updateTxControlsUI();
      syncPlayerStage();
    });

    // Seletor de Resolução (720p / 1080p)
    el.resolutionButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = btn.dataset.resolution;
        if (!RESOLUTIONS[res] || state.tx.resolution === res) return;
        state.tx.resolution = res;

        el.resolutionButtons.forEach((b) => {
          const active = b.dataset.resolution === res;
          b.classList.toggle('active', active);
          b.setAttribute('aria-checked', String(active));
        });

        el.labelResolutionDetail.textContent = RESOLUTIONS[res].label;
        applyLiveTrackConstraints();
      });
    });

    // Seletor de FPS (30 / 60)
    el.fpsButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const fps = Number(btn.dataset.fps);
        if ((fps !== 30 && fps !== 60) || state.tx.fps === fps) return;
        state.tx.fps = fps;

        el.fpsButtons.forEach((b) => {
          const active = Number(b.dataset.fps) === fps;
          b.classList.toggle('active', active);
          b.setAttribute('aria-checked', String(active));
        });

        el.labelFpsDetail.textContent = fps === 60 ? 'Suave para jogos/vídeo' : 'Economiza banda/CPU';
        applyLiveTrackConstraints();
      });
    });

    // Seletor de Prioridade (Nitidez = maintain-resolution | Fluidez = maintain-framerate)
    el.priorityButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const pref = btn.dataset.priority;
        if (
          (pref !== 'maintain-resolution' && pref !== 'maintain-framerate') ||
          state.tx.degradationPreference === pref
        ) {
          return;
        }
        state.tx.degradationPreference = pref;

        el.priorityButtons.forEach((b) => {
          const active = b.dataset.priority === pref;
          b.classList.toggle('active', active);
          b.setAttribute('aria-checked', String(active));
        });

        el.labelPriorityDetail.textContent =
          pref === 'maintain-resolution' ? 'Mantém 720p/1080p nítido' : 'Prioriza 60 FPS';

        if (state.tx.stream) {
          const vTrack = state.tx.stream.getVideoTracks()[0];
          if (vTrack && 'contentHint' in vTrack) {
            vTrack.contentHint = pref === 'maintain-resolution' ? 'detail' : 'motion';
          }
          applyBitrateToAllOutbound();
          showToast(
            pref === 'maintain-resolution'
              ? 'Prioridade: Nitidez (resolução preservada).'
              : 'Prioridade: Fluidez (FPS preservado).',
            'success',
            2200
          );
        }
      });
    });

    // Slider de Bitrate Máximo por espectador (1 a 6 Mbps, padrão 2.5 Mbps)
    el.sliderBitrate.addEventListener('input', () => {
      state.tx.bitrateMbps = Number(el.sliderBitrate.value);
      updateBitrateSliderUI();

      if (state.tx.bitrateDebounce) clearTimeout(state.tx.bitrateDebounce);
      state.tx.bitrateDebounce = window.setTimeout(() => {
        applyBitrateToAllOutbound();
      }, 100);
    });

    el.sliderBitrate.addEventListener('change', () => {
      if (state.tx.stream && state.tx.outboundCalls.size > 0) {
        showToast(
          `Bitrate máximo aplicado: ${state.tx.bitrateMbps.toFixed(1)} Mbps por espectador.`,
          'success',
          2200
        );
      }
    });

    // Checkbox Capturar áudio do sistema
    el.checkboxSystemAudio.addEventListener('change', () => {
      state.tx.captureAudio = el.checkboxSystemAudio.checked;
      if (state.tx.stream) {
        showToast('Clique em "Trocar Tela" para aplicar a mudança de áudio do sistema.', 'info', 3500);
      }
    });

    // Player: Volume, Mute, Unmute Banner, Grade, PiP, Fullscreen
    el.btnMute.addEventListener('click', togglePlayerMute);
    el.sliderVolume.addEventListener('input', () => {
      setPlayerVolume(el.sliderVolume.value);
    });

    el.btnUnmuteBanner.addEventListener('click', () => {
      const targetVol = state.player.volume > 0 ? state.player.volume : 100;
      setPlayerVolume(targetVol);
      el.btnUnmuteBanner.classList.add('hidden');
      el.mainVideo.play().catch(() => {});
    });

    el.btnGridMode.addEventListener('click', () => {
      state.player.gridMode = !state.player.gridMode;
      renderStreamSwitcher();
      renderParticipantsList();
      syncPlayerStage();
    });

    el.btnPip.addEventListener('click', togglePictureInPicture);
    el.btnFullscreen.addEventListener('click', toggleFullscreen);
    el.mainVideo.addEventListener('dblclick', toggleFullscreen);

    document.addEventListener('fullscreenchange', syncFullscreenIcons);
    document.addEventListener('webkitfullscreenchange', syncFullscreenIcons);

    el.playerStage.addEventListener('mousemove', scheduleControlsAutoHide);
    el.playerStage.addEventListener('touchstart', scheduleControlsAutoHide, { passive: true });
    el.playerControls.addEventListener('mouseenter', () => {
      if (state.player.controlsHideTimer) clearTimeout(state.player.controlsHideTimer);
      el.playerStage.classList.remove('controls-hidden');
    });
    el.playerControls.addEventListener('mouseleave', scheduleControlsAutoHide);

    // Atalhos de teclado dentro da sala
    document.addEventListener('keydown', (e) => {
      if (state.mode !== 'room') return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (key === 'm') {
        e.preventDefault();
        togglePlayerMute();
      } else if (key === 't') {
        e.preventDefault();
        toggleCinemaMode();
      }
    });

    window.addEventListener('beforeunload', () => {
      if (state.mode === 'room' && state.isOwner) {
        broadcastFromOwner({ type: 'room-closed' });
      }
      if (state.peer && !state.peer.destroyed) {
        try { state.peer.destroy(); } catch (_) {}
      }
    });
  }

  /* ------------------------------------------------------------------------
     INICIALIZAÇÃO
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
