# Transmissão Do Pedrão — Sala P2P Colaborativa

Webapp estático moderno em modo escuro (HTML, CSS e JavaScript puros) para transmissão de tela ponto-a-ponto usando **PeerJS (via CDN)** e **WebRTC nativo**. Qualquer pessoa na sala pode **transmitir sua tela e assistir às telas dos outros ao mesmo tempo**, pronto para **GitHub Pages** ou **Vercel** sem backend.

## Recursos

- **Tela Inicial**:
  - Botão **Criar Sala** com código curto (6 caracteres) copiável com 1 clique e link direto `?room=ID`.
  - Entrada rápida via código da sala ou colando o link completo.
- **Sala Compartilhada (Todos Transmitem & Assistem)**:
  - **Painel de Transmissão** disponível para qualquer participante: resolução (`720p` ou `1080p`), FPS (`30` ou `60`), slider de **Bitrate Máximo por espectador** (`1.0` a `6.0 Mbps`, padrão `2.5 Mbps`) e checkbox **Capturar áudio do sistema** via `navigator.mediaDevices.getDisplayMedia`.
  - **Controle de Banda Obrigatório**: ao iniciar `peer.call()` para cada participante da sala, acessa `call.peerConnection.getSenders()` e aplica `setParameters()` na track de vídeo definindo `encodings[0].maxBitrate`, com atualização em tempo real ao mover o slider (suporta até 7 pessoas na sala = até 6 envios simultâneos por transmissor).
  - **Player Cinema & Grade Multi-Tela**: player responsivo em modo cinema (`T`), tela cheia (`F`), Picture-in-Picture, controle de volume local (`M`), barra de troca rápida entre telas ao vivo, modo **Grade** quando há 2+ transmissões simultâneas, indicador de latência/status, HUD `Stats` e lista sincronizada de quem está na sala.
- **STUN Público do Google**:
  - Configurado com `stun:stun.l.google.com:19302` e `stun1.l.google.com:19302`.
