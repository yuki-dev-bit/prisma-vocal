# Diagnóstico e resultado — visualizadores de áudio

Medido em 03/11/2026, não estimado. Ferramenta: `scripts/perf-hud.mjs` (Chromium com microfone
sintético, viewport 390×844 @2x, UA de Android, taxa de captura 44,1 kHz).

```
npm run perf:hud                                  # Android aproximado (CPU 4× mais lenta)
node scripts/perf-hud.mjs --throttle 1            # PC
node scripts/perf-hud.mjs --throttle 4 --profile  # + top de funções por tempo próprio
node scripts/perf-hud.mjs --dev --profile         # dev server: nomes legíveis
```

## 1. Causa raiz — não era o desenho

O perfil de CPU (`.tsx`/`.ts` legíveis) mostrou **97 % do tempo de script** numa única função:
`resampleBlock` (`src/core/dsp/resample.ts`). O HUD era vítima, não culpado.

- `VoiceAnalyzer.push` roda no callback de **cada bloco de áudio** (`analyzer.ts:239`).
- A cada hop de 16 ms ele reamostra a janela de 2.048 amostras (128 ms) de 48 kHz/44,1 kHz para
  16 kHz com kernel windowed-sinc de 24 taps.
- O kernel era recalculado **por tap, por amostra de saída**: 2.048 × 24 × 3 transcendentais
  (`sin` + 2 `cos`) ≈ 147 mil `sin`/`cos` por hop, ×62,5 hops/s ≈ **9,2 milhões por segundo**.
- O coeficiente depende só da **fase** da posição de leitura (`t − ⌊t⌋`) e do índice do tap. Com
  taxas inteiras a fase assume no máximo `fsOut / mdc(fsIn, fsOut)` valores — 1 em 48 kHz→16 kHz,
  160 em 44,1 kHz→16 kHz — ou seja, os mesmos 24 números eram recalculados milhões de vezes.
- Ainda dentro do laço mais interno: `h = 2 × cutoff` e `d / half` recalculados por tap.

Consequência: thread principal saturado, `requestAnimationFrame` do HUD só rodava na sobra
(**13 fps**), toque/scroll engasgando, áudio competindo com a interface.

## 2. Custos secundários (medidos, não supostos)

| Item | Como aparecia | Correção |
|---|---|---|
| `FormantPlot` | até 900 `stroke()` por quadro, cada um com uma string `rgba()` nova | ~16 traços agrupados por faixa de opacidade; trilha em buffers reaproveitados |
| `PitchRibbon` | `createLinearGradient` recriado por quadro; 1 objeto por amostra por quadro | gradiente e moldura na camada estática; coordenadas em `Float32Array` fixo |
| `Spectrogram` | 18 `fillStyle` em string + 18 `fillRect` por quadro; 11 operações de texto por quadro | coluna escrita direto nos bytes (`putImageData`), rótulos em camada estática |
| `LevelMeter` | 28 elementos React recriados a 10 Hz | segmentos montados uma vez; `on` alternado no DOM |
| `useCanvas` | `paint()` síncrono no resize e loop pintando mesmo sem dado novo | `shouldPaint` + repintura garantida quando prop muda |

O `FormantPlot` caiu de 644 ms para 86 ms de CPU própria no mesmo cenário (7,5×).

## 3. Resultado — Android (CPU 4× mais lenta, 8 s de captura)

| Métrica | Antes (3 execuções) | Depois (3 execuções) |
|---|---|---|
| Quadros | 13,8 / 12,8 / 13,4 fps | **54,4 / 56,5 / 54,8 fps** |
| Quadro médio | 125 / 125 / 127 ms | **18,4 / 17,7 / 18,3 ms** |
| p50 | 126 / 123 / 127 ms | **17,8 / 17,2 / 17,3 ms** |
| p95 | 137 / 140 / 142 ms | **27,3 / 26,5 / 30,5 ms** |
| Quadros acima de 33 ms | **100 %** | **2,5 / 1,5 / 2,3 %** |
| Long tasks (8 s) | 6 / 5 / 7 (465 / 382 / 599 ms) | **4 / 4 / 4 (527 / 401 / 424 ms)** |
| CPU de script | 8,84 / 8,56 / 8,91 s de ~9,6 s (~91 %) | **3,32 / 3,24 / 3,37 s de ~7,7 s (~43 %)** |
| Heap | 7,6–7,8 MB | 7,0–7,8 MB (sem mudança) |

## 4. Resultado — PC (sem limitação de CPU)

| Métrica | Antes | Depois |
|---|---|---|
| Quadros | 59,9 / 60,0 fps | 59,9 / 60,0 fps |
| p95 | 22,6 / 21,1 ms | **17,6 / 17,2 ms** |
| Pior quadro | 42,2 / 41,5 ms | **40,9 / 22,3 ms** |
| Long tasks | 0 | 0 |
| CPU de script (8 s) | 3,75 / 3,68 s (~49 %) | **0,80 / 0,82 s (~10 %)** |

No PC a taxa de quadros já era 60; o ganho é de folga: um núcleo deixa de ficar meio ocupado só
desenhando o HUD (bateria, ventoinha, áudio sem competição).

## 5. DSP isolado (`VoiceAnalyzer`, 10 s de áudio, sem interface)

| Taxa | Antes | Depois |
|---|---|---|
| 44,1 kHz | 22,7 % de um núcleo | **6,9 %** |
| 48 kHz | 20,1 % de um núcleo | **6,7 %** |
| Só a reamostragem, 44,1 kHz | 14,9 % | **0,9 %** |
| Só a reamostragem, 48 kHz | 13,7 % | **0,8 %** |

Contagem de quadros analisados idêntica (617 quadros em 44,1 kHz, 567 em 48 kHz): não houve mudança
de comportamento, só de custo.

## 6. O que sobra e por quê

- **DSP é agora o maior custo no Android**: ~7 % de um núcleo, ~27 % do orçamento com CPU 4× mais
  lenta. O próximo passo real seria tirar o analisador do thread principal (Worker/Worklet). Não
  foi feito nesta rodada: é mudança de arquitetura, não otimização local, e precisa de etapa
  própria com o mesmo tipo de medição.
- **Re-render do React a 10 Hz** (cronômetro, leituras) chegou a ser hipótese de trabalho. O perfil
  depois das outras correções não mostra reconciliação entre as 15 funções mais caras (< 50 ms em
  6 s), então **não** foi mexido — evita refatoração sem ganho.
- **Recálculos de estilo (~60/s)** vêm de animações/transições do tema. Testado: remover a
  transição do medidor não mudou a contagem; ficou como está.
- **Limites da medição**: nada aqui foi executado em aparelho Android real nem em `.exe`/APK. A
  limitação de CPU de 4× é uma aproximação de celular de faixa média, reproduzível entre execuções
  (mesma máquina, mesmo build) — o que serve para comparar antes/depois, não para prometer número
  absoluto em um aparelho específico.
- As medições de PC usam o **bundle de produção em Chromium**, não o binário do Electron. No
  repositório do desktop o Electron foi validado separadamente para o que muda nesta rodada de
  interface (janela monta com o bundle de produção, fechamento com descarga, persistência entre
  execuções) — passou. Taxa de quadros dentro do Electron não foi medida.
- Ambiente das execuções: Node 20.20.2 no sandbox (o projeto pede ≥ 22.12), Chromium 156 headless.
  `typecheck`, `lint`, `format:check`, 351 testes, `smoke`, `smoke:mic`, `verify:desktop` e
  `test:mobile` passaram; `test:coverage` ficou em 97,8 / 91,4 / 99,6 / 99,5.
