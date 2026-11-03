# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento
semântico.

> Os marcos do app Android (Capacitor) ficaram no repositório
> [prisma-vocal-android](https://github.com/yuki-dev-bit/prisma-vocal-android).

## [1.0.1] — 2026-11-03

### Desempenho

- **HUD fluido no Android.** O thread principal ficava saturado por causa da reamostragem 48 kHz →
  16 kHz feita a cada 16 ms: os coeficientes do kernel (24 taps) eram recalculados com `sin`/`cos`
  para cada amostra de saída — cerca de 9 milhões de funções trigonométricas por segundo. Agora o
  kernel é calculado uma vez por fase de leitura e reaproveitado entre blocos
  (`src/core/dsp/resample.ts`). Efeito medido: a análise ao vivo caiu de 22,7 % para 6,9 % de um
  núcleo em 44,1 kHz (o caso mais caro) e o HUD saiu de ~13 fps para ~55 fps com CPU 4× mais lenta.
- **Gráficos do HUD**: grade, rótulos e bordas ficaram numa camada estática (`useStaticLayer`); a
  trilha de formantes passou de um traço por segmento (~900 `stroke` por quadro) para ~16 traços
  agrupados por opacidade; a fita de altura não recria mais o gradiente nem aloca um objeto por
  amostra; o espectrograma escreve a coluna direto nos bytes da imagem. Quando não há dado novo o
  canvas não é repintado.
- **Medidor de nível**: os 28 segmentos são montados uma vez e o estado liga/desliga alterna direto
  no DOM, sem recriar 28 elementos React a 10 Hz.
- **Plano de formantes**: o título do eixo F2 não encosta mais no rótulo do último tick.
- Novo `npm run perf:hud` (`scripts/perf-hud.mjs`) mede quadros, long tasks, layouts e CPU do HUD com
  microfone sintético; o diagnóstico está em `docs/DIAGNOSTICO-HUD.md`.

### Testes

- 355 testes (antes 352): reamostragem comparada tap a tap com a implementação direta, uso do banco
  de coeficientes quente ou frio e taxa não inteira.

## [1.0.0] — 2026-10-30

Primeira versão utilizável.

### Adicionado

- **Análise ao vivo (HUD)**: fita de altura com grade de notas, espectrograma de 18 bandas, plano de
  formantes F1×F2, medidor de nível com zonas e quatro mostradores de resumo.
- **Tomadas**: captura de fala/voz sustentada/livre, métricas robustas da sessão, feedback
  pedagógico (o que / por que / como), salvamento opcional do áudio cifrado.
- **Trilha de treino**: 11 módulos, 22 aulas, 28 exercícios, com metas relativas à linha de base e
  detecção de conclusão.
- **Avaliação vocal**: protocolo de 7 etapas, perfil (piso/centro/teto/extensão/posição do centro),
  forças, desafios e sugestões de metas.
- **Progresso**: gráficos por métrica, altura relativa em semitons, metas com barra de progresso,
  relatório HTML/Markdown autocontido.
- **Diário vocal** com humor, energia, notas e etiquetas.
- **Gravações**: ouvir, comparar duas tomadas com deltas, exportar WAV, apagar.
- **Configurações**: dispositivo de entrada, ganho, sensibilidade, gate, monitoramento, latência,
  taxa, calibração dBFS→dB SPL, presets de voz, tema, densidade do HUD, idioma.
- **Acessibilidade**: escala de fonte, alto contraste, movimento reduzido, paleta para daltonismo,
  navegação por teclado com skip-link, modais com foco preso, ARIA nos gráficos.
- **Privacidade**: AES-256-GCM no disco, chave via `safeStorage`, backup sem áudio, exclusão total,
  retenção configurável, modo navegador com aviso explícito.
- **Empacotamento**: electron-builder para AppImage/deb, NSIS e dmg; ícones em todas as resoluções.
- **Testes**: 84 testes de núcleo (DSP, análise, metas, progresso, feedback, migração, relatório).

### Corrigido

- `npm run dev` falhava em Vite 6+ (`ERR_PACKAGE_PATH_NOT_EXPORTED` ao resolver
  `vite/bin/vite.js`); agora o CLI é resolvido pelo campo `bin` do `package.json`.
- **CI vermelho no primeiro push**: a pré-checagem chamava `require('electron')`, que tenta
  baixar ~120 MB quando o binário não existe — nos runners (com
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1`) o passo `npm run smoke` falhava. Agora o caminho do
  binário é lido do `path.txt` do pacote (sem rede) e o modo `--check` trata o binário como
  opcional, porque ele não é iniciado. `postinstall` também deixou de depender de rede.
- `npm run smoke` lia `dist-electron/main.cjs`, que não existe num clone limpo (o job de
  typecheck não compila) — reprovava no CI com `ENOENT`. Agora a verificação da CSP de
  desenvolvimento é feita na fonte (`electron/main.ts`) e o bundle só é comparado quando
  existe; o job de typecheck passou a rodar `npm run build:electron` antes do smoke.
- Actions atualizadas para `checkout@v5`, `setup-node@v5` e `upload-artifact@v5`
  (fim do aviso de Node 20 nos runners).
- **Janela do Electron abria em branco no `npm run dev`**: a CSP de produção
  (`script-src 'self'`, `connect-src 'self'`) era aplicada também ao dev server e bloqueava
  o preâmbulo inline do React Refresh e o WebSocket do HMR — a interface nunca montava
  (`can't detect preamble`). O modo de desenvolvimento agora usa `CSP_DEV` no processo
  principal e o plugin `devCsp` no Vite; o bundle de produção continua com a política estrita.
- A janela nunca mais falha em silêncio: `did-fail-load` mostra um diálogo com o erro e, em
  desenvolvimento, o console do renderer é espelhado no terminal (`[renderer:error] ...`).
- Novo `npm run smoke` / `scripts/smoke-dev.mjs`: sobe o Vite de verdade e falha se a CSP de
  dev ou o entrypoint do renderer estiverem errados (regressão do item acima).
- `scripts/dev.mjs` tinha uma referência pendente (`preflight`) após a refatoração do diagnóstico;
  `npm run smoke` agora valida o caminho de inicialização para impedir regressão.
- `npm run dev` agora faz pré-checagem das dependências (`npm run doctor`) e explica como corrigir
  quando o npm bloqueia os scripts de instalação do Electron.
- Build em produção embutia o AudioWorklet como `data:` URL (bloqueado pela CSP); agora é asset
  próprio, com verificação no CI.
- Lista de dispositivos, sidebar e topbar não se comportavam bem com escala de fonte grande.

#- Novo `docs/ATUALIZAR.md`: rotina de sincronização com o GitHub (mudanças locais, zip novo,
  dependências, `npm version`, release e CI vermelho com 502 no endpoint de jobs).
- Documentação: `docs/LIMITATIONS.md` agora distingue o que passa em runner Windows real (CI)
  do que segue sem verificação em hardware (app empacotado, microfone, DPAPI). README ganhou o
  badge do CI.

## Adicionado

- **Alvo Android (Capacitor)** — o mesmo renderer e o mesmo DSP dentro de um WebView:
  - `src/renderer/state/bridge-android.ts`: armazenamento em IndexedDB com **AES-GCM** e chave
    AES-256 não-extraível (`crypto-box.ts`); exportação de WAV/relatório/backup pela folha de
    compartilhamento; importação de backup pelo seletor de arquivos; lembretes via notificações
    locais; `logError` e `openExternal` respeitando a allowlist de https.
  - `src/renderer/state/idb.ts`: helpers de IndexedDB compartilhados com o modo navegador.
  - `android/`: projeto Gradle completo (ícone, splash, `RECORD_AUDIO`, `POST_NOTIFICATIONS`,
    `allowBackup="false"`, `networkSecurityConfig` sem texto claro).
  - Layout de celular (≤ 640 px): navegação inferior com ícones, área segura, alvos de toque de
    44 px, gráficos empilhados.
  - Escala própria de celular: tokens de tipografia e espaçamento reduzidos (~10%) mantendo a
    `--font-scale` do usuário por cima; cartões de número em 2 colunas; HUD com 3 leituras por
    linha; leitura do modo quebrando em duas linhas em vez de cortar texto; segunda passada em
    ≤ 380 px.
  - PWA/ícones: `public/manifest.webmanifest` e ícones 192/512 + maskable.
  - Scripts: `smoke:android` (executa o bridge Android em Chromium e confere que o dado salvo está
    cifrado e que a chave não é extraível) e `screenshots:mobile` (4 capturas em 390×844).
  - Documentação: `docs/ANDROID.md` (requisitos, build, APK assinado, diferenças, limites).

## Corrigido (auditoria da versão desktop / Electron)

- **Fechamento podia perder a última alteração.** O renderer grava com debounce de 450 ms; ao fechar
  a janela, o Electron destruía o processo antes do IPC de gravação terminar. Agora o `close` é
  interceptado: o processo principal envia `app:flush-request`, espera o `app:flush-done` (com prazo
  de 1,5 s para nunca travar) e só então destrói a janela. Validado em Electron real por
  `npm run smoke:desktop`, que falha se a porta de fechamento for desativada.
- **Gravações simultâneas corrompiam o arquivo de dados.** `writeAtomic` usava
  `${arquivo}.tmp-${pid}`: os dados (debounce) e a calibração (gravação imediata) podiam escrever no
  mesmo temporário e publicar JSON truncado. Escritas passaram a ser serializadas por uma fila e o
  temporário ganhou sufixo único; acrescentado `fsync` antes do rename (desligamento abrupto podia
  deixar o arquivo renomeado e vazio).
- **Janela abria maior que a tela e esquecia posição/tamanho.** Antes: sempre 1280×860 na posição
  padrão, com `minWidth: 940` fixo — em tela 1024×600 ou com monitor desconectado a janela nascia
  cortada. Agora a geometria é salva em `window-state.json`, validada contra a área útil do monitor
  (recentraliza se estiver fora, limita ao espaço disponível, ajusta o mínimo) e o estado maximizado
  é restaurado.
- **Lembretes se perdiam.** O agendador comparava `HH:MM` por igualdade a cada 30 s: se o computador
  voltasse da suspensão depois daquele minuto, o lembrete do dia não tocava. Nova regra com janela de
  tolerância de 30 min, disparo único por dia e log do atraso.
- **Backup podia sair desatualizado.** `data:export-backup` relia o disco, que pode estar 450 ms
  atrás do que está na tela. O renderer agora envia o estado em memória (validado no processo
  principal antes de escrever) e o disco é só o plano B.
- **`isPackaged`/versão errados.** `systemInfo` usava `NODE_ENV` e `npm_package_version`; agora usa
  `app.isPackaged` e `app.getVersion()`.
- **Diálogos salvavam no lugar errado.** O caminho inicial era `~/Downloads` montado à mão (e caía na
  pasta do usuário quando não existia); passou a usar `app.getPath('downloads')`, que respeita
  OneDrive/redirecionamentos no Windows e XDG no Linux.
- **Log podia derrubar o processo.** `log()` fazia `JSON.parse(redact(JSON.stringify(meta)))`; com
  metadados grandes o `redact` truncava o JSON, o parse lançava — inclusive dentro do handler de
  `uncaughtException`. O saneamento passou a ter fallback e o `log()` nunca lança.
- **Erro de render deixava a janela em branco.** Não havia fronteira de erro no React: uma exceção em
  qualquer tela derrubava a árvore inteira sem mensagem. Novo `ErrorBoundary` explica o ocorrido,
  avisa que os dados estão intactos, registra no log local e oferece "Recarregar interface".
- **`npm run dev` falhava com porta ocupada.** Com `--strictPort`, sobrar um preview aberto derrubava
  o comando com uma mensagem genérica. O script agora escolhe a próxima porta livre, informa a troca e
  encerra os filhos em SIGTERM/erro.

## Segurança (auditoria desktop)

- Handlers de IPC passaram a **validar a origem**: só a janela principal pode chamar `data:*`,
  `rec:*` e `sys:*`. Antes qualquer `webContents` do processo podia invocar, dependendo apenas da CSP
  para impedir uma origem estranha de carregar.
- Permissão de microfone concedida apenas quando a origem é a própria interface
  (`file://` ou o dev server); antes era liberada para qualquer `webContents`.
- `<webview>` bloqueado explicitamente (`will-attach-webview`), navegação e `window.open` fora da
  allowlist já eram negados.
- Canal morto `sys:storage-warning` removido do preload e do contrato (avisos de armazenamento já
  viajam em `loadData.warnings`), reduzindo superfície exposta.

## Corrigido (auditoria de microfone e calibração)

- **Microfone negado no Android com a permissão autorizada** (dois aparelhos). Causa raiz: o
  Capacitor, em `BridgeWebChromeClient.onPermissionRequest()`, pede `RECORD_AUDIO` **e**
  `MODIFY_AUDIO_SETTINGS` ao sistema e só libera o `getUserMedia()` se as duas vierem concedidas. Uma
  revisão de segurança anterior havia removido `MODIFY_AUDIO_SETTINGS` do manifesto (parecia não
  usada), e uma permissão pedida e não declarada volta como negada — o WebView negava a captura
  sempre. O manifesto voltou a declará-la, com o motivo escrito, e `tests/android-manifest.test.ts`
  reprova o build se ela (ou a `RECORD_AUDIO`) desaparecer de novo.
- **Diagnóstico de erro de áudio**: `NotReadableError`/`AbortError` (microfone ocupado) e
  `NotSupportedError` deixaram de cair em "permissão negada". Cada causa tem mensagem e ação próprias,
  e o chip do HUD não diz mais "permissão negada" quando o microfone só está em uso por outro app.
  Mensagens de permissão no Android agora citam o caminho de Ajustes e a necessidade de reabrir o app.
- **Calibração não parecia salva**: o offset era limitado a 60 dB; valores reais (60–105 dB) eram
  truncados e a estimativa de SPL saía dezenas de dB abaixo do medidor externo. Teto passou a 120 dB.
- **Calibração não refletia na hora**: o analisador só lia o offset no construtor, então calibrar com
  o medidor rodando não mudava o SPL até reiniciar a captura. Novo `VoiceAnalyzer.setCalibrationOffset()`
  aplica o valor ao vivo.
- **Calibração medida sobre um quadro só**: calibrar usava o nível instantâneo; um quadro silencioso
  gerava offset absurdo. Agora usa a mediana de ~0,6 s e recusa sinal abaixo de −70 dBFS.
- **Persistência frágil ao fechar o app**: gravação com debounce de 450 ms e descarga só em
  `beforeunload` (que o WebView não dispara quando o processo é morto). Agora existe caminho imediato
  (`updateSettings(..., { immediate: true })`, usado na calibração) e descarga em `pagehide` e em
  `visibilitychange`.
- **Modal atrás da navegação**: `.main` tem `z-index: 1` e a barra lateral/barra inferior `z-index: 2`,
  então o diálogo (z-index 60) ficava preso no contexto de empilhamento do conteúdo e era coberto pela
  navegação — dava para tocar no menu com um diálogo aberto. `Modal` agora renderiza em portal para o
  `body` e trava a rolagem do fundo.
- **Intervalo recriado em loop**: no diálogo de calibração, o `setInterval` dependia do objeto
  `session` (novo a cada render, 10 Hz) e nunca chegava a disparar — o nível ficava em "aguardando
  áudio…" e o botão Salvar nunca habilitava. Dependências reduzidas a `open`/`step`.
- **Versão errada na tela inicial**: o chip mostrava `schemaVersion` (v1.0) em vez de `APP_VERSION`
  (1.0.0).
- Texto de ajuda da calibração (`calibrationHint`, pt-BR e en) descrevia um "tom de referência" que o
  app não emite; agora descreve o procedimento real.

## Adicionado (calibração guiada)

- `CalibrationDialog`: três passos (explicar → medir → confirmar), medidor ao vivo, cálculo do offset
  com prévia, recusa de sinal fraco e confirmação com offset + data/hora salvos.
- Convite na tela inicial ("Antes de começar: calibre o microfone"), dispensável, que explica para
  que serve e o que muda sem ela.
- Campos `audio.calibratedAt` e `audio.calibrationPromptDismissed` (migração compatível: dados
  antigos viram "nunca calibrado", sem inventar valor).
- `src/core/audio/calibration.ts`: regras puras (cálculo, limites, formatação) testáveis sem DOM.
- `npm run smoke:mic`: microfone sintético em Chromium validando captura, calibração, persistência
  após reload e o caminho de permissão negada. `npm run verify:mobile` encadeia as verificações mobile.

## Alterado (adaptação mobile e revisão de qualidade)

- **Layout mobile auditável**: novo `npm run test:mobile` percorre 7 tamanhos de tela × 8 telas
  (320–412 px, paisagem 568×320 e 844×390, tablet 768) e reprova rolagem horizontal, elemento fora
  da tela, alvo de toque < 44 px, texto cortado e erro de console. Estado atual: **0 problemas**.
- Correções que o teste apontou: abas de Configuração estouravam a largura (Privacidade ficava
  fora da tela); barra inferior com 8 seções cortava as últimas em 320 px (agora grade 4×2);
  botões e sliders de 38 px (agora 44 px); checkbox de 13 px (agora 24 px, WCAG 2.2).
- `grid-template-columns` inline em `TrainView` e `minWidth` fixo em `RecordingsView` viraram
  classes (`.grid.analyze.side-narrow`, `.field-inline`) — layout em CSS, não em `style` que
  ignora media query.
- Regras de toque passaram de "largura ≤ 640 px" para `@media (pointer: coarse)`: tablet de 768 px
  tem o mesmo problema de alvo pequeno que um telefone, e navegador estreito no desktop tem mouse.
- `useCanvas` reescrito: proporção explícita (`aspect`) em vez do heurístico
  `canvas.height / canvas.width`, DPR limitado a 2, pausa do loop com aba oculta e com canvas fora
  da viewport (bateria), e `IntersectionObserver`/`ResizeObserver` corretamente limpos.
- **Versão única**: `src/shared/version.ts` (`APP_VERSION`) substituiu o `'1.0.0'` repetido em três
  arquivos, com teste garantindo que acompanha o `package.json`.

## Segurança (revisão)

- CSP de produção endurecida: `connect-src 'self'` (antes permitia `ws:` e `http://localhost:*`,
  sobra do modo de desenvolvimento). O dev continua com política própria, injetada pelo plugin.
- `MODIFY_AUDIO_SETTINGS` removida do manifesto — permissão que nada usava.
- `openExternal` no Android passou a usar a mesma allowlist do desktop (`https://github.com/yuki-dev-bit`).
- Varredura de segredos no repositório (chaves, tokens, keystores): nada encontrado; `.gitignore`
  cobre `*.jks`, `*.keystore`, `android/keystore.properties` e `docs/screenshots/layout/`.

## Corrigido

- `scripts/check-deps.mjs` dava falso negativo em Linux/macOS: o `path.txt` do Electron traz
  `electron` (relativo a `dist/`) e não `dist/electron`, então `npm run dev` recusava iniciar com o
  binário presente.

## Notas

- DSP 100% TypeScript: YIN para f0, LPC/Levinson-Durbin para formantes, HNR por autocorrelação.
- Índice de ressonância é relativo (compara você com você).
- Dependências: Electron 45, Vite 8, Vitest 5, electron-builder 26, esbuild 0.28 — `npm audit` sem
  vulnerabilidades conhecidas; requisito mínimo Node 22.12.
- Validação manual em hardware: Linux. Windows/macOS: pacotes gerados, execução não verificada.
