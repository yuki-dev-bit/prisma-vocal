# Arquitetura

## Visão geral

```
┌───────────────────────────── Electron (main, Node) ─────────────────────────────┐
│ main.ts        janela, CSP, permissões, navegação, single-instance, diálogos    │
│ ipc.ts         handlers de IPC com validação de payload                          │
│ SecureStore    AES-256-GCM, chave via safeStorage, escrita atômica + .bak       │
│ logger.ts      log rotativo em disco (sem áudio, sem conteúdo do diário)        │
│ preload.ts     contextBridge: `window.prisma` tipado, sem ipcRenderer cru       │
└──────────────────────────────────────────────────────────────────────────────────┘
                                    ▲ IPC (persistência e IO apenas)
┌──────────────────────────── Renderer (React 19 + Vite) ──────────────────────────┐
│ views/         Início, Analisar, Treinar, Avaliação, Progresso, Diário,          │
│                Gravações, Configurações                                          │
│ components/hud canvases em rAF lendo ring buffer (PitchRibbon, Spectrogram,      │
│                FormantPlot, LevelMeter, GaugeArc)                                │
│ state/store    Context + reducers puros de core, debounce 450 ms, banners        │
│ state/useLiveSession  engine → worklet → VoiceAnalyzer → LiveBuffer + readout    │
│ audio/         AudioEngine (getUserMedia + AudioWorklet), Recorder, playback     │
└──────────────────────────────────────────────────────────────────────────────────┘
                                    ▲ imports puros
┌────────────────────────────────── src/core ─────────────────────────────────────┐
│ dsp/ fft, window, resample, yin, lpc, features, wav                              │
│ analysis/ analyzer (quadro + agregação), compare (deltas A/B)                    │
│ assessment/ profile (protocolo de 7 etapas, perfil, metas sugeridas)             │
│ training/ curriculum (11 módulos), evaluate (metas), progress, recommender       │
│ feedback/ engine (o que/por que/como)                                            │
│ storage/ repository (migração + saneamento), reports/ (HTML/Markdown)            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

`src/core` não importa React nem Electron e é testado em Node puro. Isso é deliberado: a parte que
produz números precisa ser auditável e determinística, independente da interface.

## Fluxo de áudio em tempo real

1. `AudioEngine.start()` pede `getUserMedia` com `echoCancellation`, `noiseSuppression` e
   `autoGainControl` **desligados** (esses filtros alteram medidas acústicas) e cria um
   `AudioContext` na taxa nativa.
2. O worklet `capture-processor.js` aplica ganho suavizado, aplica o gate opcional, calcula pico/RMS,
   detecta clipping e envia blocos de 128 amostras por `port.postMessage` (buffer transferido).
3. `VoiceAnalyzer.push()` acumula, reamostra para 16 kHz e emite um `FrameMetrics` a cada 16 ms.
4. Cada quadro entra no `LiveBuffer` (ring de 900 quadros ≈ 14 s) e na lista da sessão.
5. Os canvases leem o ring via `requestAnimationFrame` (limitado a ~12 fps quando o usuário pede
   movimento reduzido). O React **não** re-renderiza por quadro: só recebe um readout numérico a
   10 Hz (`useLiveSession`).
6. Ao parar, `aggregateFrames()` gera as métricas da sessão e o `Recorder` entrega o PCM (se a
   gravação estava ativa), que é salvo cifrado e indexado nos metadados.

Racional: 60 fps de estado React com gráficos de 900 pontos causa GC e jank. Canvas fora do React
resolve o desenho; o estado fica para números e rótulos.

## Estado e persistência

- `store.tsx` mantém `AppData` (perfil, sessões, progresso, gravações, diário, metas, settings),
  aplica reducers puros de `core/training` e persiste com debounce de 450 ms.
- `bridge.ts` escolhe a implementação: **IPC** (Electron, cifrado) ou **IndexedDB** (navegador,
  aviso permanente de ausência de criptografia).
- `migrateData()`/`sanitizeSettings()` nunca lançam: devolvem dados recuperáveis + lista de
  problemas, que a UI mostra como aviso em vez de abrir em tela branca.
- Limites: 500 sessões, 300 entradas de diário, 12 min por gravação. Retenção configurável.

## Decisões que valem registro

| Decisão | Alternativa descartada | Por quê |
| --- | --- | --- |
| DSP em TS puro no `core` | biblioteca nativa / WASM | auditável, testável em Node, sem binários por plataforma |
| Análise no renderer | processo principal | Web Audio é do renderer; evita cópia de áudio por IPC em tempo real |
| `safeStorage` + AES-GCM | senha mestra | atrito zero para o uso diário; modelo de ameaça documentado em SECURITY.md |
| Metas relativas à linha de base | metas absolutas em Hz | o objetivo é a sua evolução, não atingir o número de outra pessoa |
| `noiseSuppression` desligado | confiar no filtro do navegador | o filtro distorce HNR, soprosidade e inclinação espectral |
| Nota `null` quando não há meta | zero | "0/100" sugere falha onde não havia o que medir |
| Canvas no HUD | SVG/Recharts | 900 pontos × 60 fps em SVG derruba frames |

## Build

- `vite build` → `dist/` (renderer). O worklet é um asset próprio servido localmente.
- `scripts/build-electron.mjs` (esbuild) → `dist-electron/main.cjs` + `preload.cjs` (CJS).
- `electron-builder.yml` empacota `dist/`, `dist-electron/`, `build/icon.png` e `package.json`
  (AppImage/deb, NSIS, dmg).

## Testes

`vitest` em Node: DSP (FFT, YIN, LPC, formantes, WAV), análise (quadro, agregação, flags),
avaliação de metas, progresso, currículo, feedback, migração de dados, relatório. Nenhum teste exige
microfone, Electron ou navegador — a interface é validada por `npm run dev:web` e pelo script de
capturas com microfone simulado.
