# Transmissão Do Pedrão — Screen Share P2P

Webapp estático moderno em modo escuro (HTML, CSS e JavaScript puros) para transmissão de tela ponto-a-ponto usando **PeerJS (via CDN)** e **WebRTC nativo**. Pronto para rodar diretamente no **GitHub Pages** ou **Vercel**, sem backend e sem etapa de build.

## Recursos

- **Tela Inicial**:
  - Botão **Criar Sala** com código curto (6 caracteres) copiável com 1 clique e link direto `?room=ID`.
  - Entrada rápida como espectador via código da sala ou colando o link completo.
- **Painel do Host**:
  - Seletor de resolução (`720p` ou `1080p`) e taxa de quadros (`30` ou `60 FPS`), com atualização ao vivo.
  - Slider de **Bitrate Máximo por espectador** (`1.0 Mbps` a `6.0 Mbps`, padrão `2.5 Mbps`) com estimativa de upload e telemetria real via `RTCPeerConnection.getStats()`.
  - Checkbox **Capturar áudio do sistema** usando `navigator.mediaDevices.getDisplayMedia` (sem filtros de voz para preservar qualidade de mídia/jogos).
  - Limite de até **6 espectadores simultâneos** com opção de remover participantes e ocultar preview local para economizar GPU.
- **Controle de Banda Obrigatório**:
  - Assim que cada espectador conecta via `peer.call()`, o app acessa `call.peerConnection.getSenders()` e aplica `setParameters()` na track de vídeo definindo `encodings[0].maxBitrate`, reforçando após negociação SDP/ICE e atualizando em tempo real ao mover o slider.
- **Tela do Espectador (Modo Cinema)**:
  - Player responsivo com modo cinema expansível (`T`), tela cheia (`F`), Picture-in-Picture e controle de volume local (`M`) com desbloqueio amigável de autoplay.
  - Indicador de status da conexão, latência em tempo real (WebRTC RTT + ping/pong via DataChannel), HUD opcional de estatísticas (`Stats`) e lista sincronizada de quem está na sala.
- **NAT Traversal**:
  - Configurado com os servidores STUN públicos do Google: `stun:stun.l.google.com:19302` e `stun:stun1.l.google.com:19302`.

## Deploy Estático (Zero Config)

- **GitHub Pages**: Suba `index.html`, `styles.css` e `app.js` para um repositório e ative *Settings → Pages → Deploy from a branch*.
- **Vercel**: Importe o repositório ou arraste a pasta no dashboard — nenhum comando de build é necessário.

> **Nota**: `getDisplayMedia` exige contexto seguro (`https://` em produção ou `http://localhost` em testes locais).
