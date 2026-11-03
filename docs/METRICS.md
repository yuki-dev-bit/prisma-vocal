# Métricas: o que medimos, como medimos e onde termina a confiança

Este documento existe porque números sem contexto enganam. Aqui está, sem marketing, o que cada
métrica significa, como é calculada, e o que ela **não** pode dizer.

## Pipeline

```
microfone (44,1/48 kHz)
   └─ AudioWorklet (ganho, gate opcional, medidor de pico) → blocos de 128 amostras
        └─ VoiceAnalyzer
             • rearquiva em ring buffer
             • reamostra para 16 kHz
             • janela de 2048 amostras (128 ms), hop de 256 (16 ms)
             • por quadro: YIN (f0), LPC (formantes), FFT (centroide, tilt, planura, bandas),
               autocorrelação no período (HNR)
        └─ aggregateFrames → estatísticas robustas da sessão
```

Escolhas e por quês:

- **16 kHz de análise**: suficiente para f0 (até 1200 Hz, com margem) e F1–F4. Reduz o custo por
  quadro em ~3× comparado a 48 kHz, o que mantém o HUD fluido em máquinas modestas.
- **Quadro de 128 ms / hop 16 ms**: 128 ms dá resolução suficiente em f0 baixa (YIN precisa de ~2,5
  períodos); hop de 16 ms dá a sensação de "tempo real" no HUD sem custo excessivo.
- **Medianas e percentis, não médias**: um clique, uma tosse ou um quadro com oitava errada não
  desloca a mediana. Médias escondem falhas; medianas as exibem no percentil.

## Métricas de sessão

| Campo | Definição | Faixa típica |
| --- | --- | --- |
| `f0MedianHz` | mediana de f0 nos quadros vozeados (confiança > 0,25) | 80–250 Hz (fala) |
| `f0P5Hz` / `f0P95Hz` | percentis 5 e 95 de f0 | — |
| `f0RangeSt` | P95 − P5 em semitons | 3–14 st (fala) |
| `f0Stability` | 100·(1 − mediana do |Δf0| entre quadros consecutivos| / 0,75 st) | 70–100 |
| `pitchDriftSt` | desvio da mediana em relação à nota alvo, em semitons | −2…+2 |
| `levelMedianDb` | mediana de nível (RMS → dBFS) em quadros acima de −72 dBFS | −30…−12 |
| `levelSdDb` | desvio padrão do nível nos quadros vozeados | < 6 dB |
| `levelStability` | 100·(1 − `levelSdDb` / 12) | 60–100 |
| `hnrMedianDb` | HNR = 10·log10(r/(1−r)), r = pico da autocorrelação normalizada no período | 10–25 dB |
| `breathiness` | 0,45·(HNR) + 0,20·tilt + 0,20·planura + 0,15·aperiodicidade | 0–1 |
| `resonanceIndex` | 100·(0,55·centroide/f0 normalizado + 0,45·energia 2–4 kHz) | 0–100 (relativo) |
| `tiltDbPerOct` | regressão de 20·log10|X| por oitava em 200–4000 Hz, ignorando bins < −60 dB do pico | −25…−5 |
| `brightness` | (`tilt` + 20) / 14, limitado a 0–1 | 0–1 |
| `formantF1Hz` / `F2Hz` | medianas de F1 e F2 por LPC (ordem calculada da taxa) | F1 300–900, F2 900–2400 |
| `prosodySt` | P90 − P10 de f0 em semitons | 2–10 st na fala |
| `registerBreaks` | saltos > 7 st entre quadros consecutivos com confiança > 0,6 | 0–3 |
| `clippingRatio` | proporção de quadros com amostra ≥ 0,994 | < 0,002 |
| `voicedRatio` | quadros vozeados / total | 0,2–0,8 na fala |

### Estabilidade de altura

Calculada sobre a **diferença entre quadros consecutivos**, em semitons, dentro de trechos vozeados.
Isso mede tremor/oscilação fina, não variação intencional de melodia. Música e fala expressiva
reduzem naturalmente o índice; compare tomadas do mesmo tipo.

### Ressonância (índice próprio)

```
ratio      = centroide(60–6000 Hz) / max(60, f0)
byRatio    = normaliza log2(ratio) entre 4 (escura) e 14 (brilhante)
byPresence = min(1, energia(2–4 kHz) / energia(60–6000 Hz) / 0,35)
índice     = 100 × (0,55·byRatio + 0,45·byPresence)
```

Normalizar o centroide pela própria f0 evita penalizar vozes graves (que têm centroide baixo por
construção). **Não existe escala absoluta de "voz bonita"** — o índice só é comparável consigo
mesmo, e muda se você trocar de microfone.

### HNR e soprosidade

HNR segue a linha de Boersma (1993): pico da autocorrelação normalizada na vizinhança do período,
convertido por `10·log10(r/(1−r))`. A soprosidade é um índice composto (HNR + inclinação espectral +
planura + aperiodicidade do YIN) — **estimativa perceptiva**, não medida de fechamento glótico.

### Formantes

LPC por autocorrelação com Levinson-Durbin; os picos do envelope são aceitos apenas se tiverem
largura de banda plausível. Limitação real e documentada: com f0 alta, os harmônicos ficam espaçados
e F1 pode se confundir com H1. Quando o algoritmo não consegue separar, devolve `null` em vez de um
número inventado (a UI mostra "—").

## Qualidade da amostra

Cada sessão recebe sinalizações (`qualityFlags`), exibidas na interface:

| Flag | Critério | O que fazer |
| --- | --- | --- |
| `amostra-curta` | < 1,2 s | grave pelo menos 3 s |
| `pouco-sinal-voz` | < 12% de quadros vozeados | fale mais alto/perto do microfone |
| `sinal-baixo` | nível mediano < −42 dBFS | aumente o ganho |
| `clipping` | > 0,2% de quadros clipados | reduza o ganho |
| `nivel-inconsistente` | desvio padrão > 8 dB | mantenha distância constante |
| `sem-calibracao` | offset SPL = 0 | calibre se quiser dB SPL |
| `ruido-alto` | planura mediana > 0,35 **ou** HNR < 6 dB com voz | procure ambiente silencioso |

## Agregação de avaliação

O protocolo de avaliação usa sete etapas (piso, centro, teto, extensão, quebra de registro, brilho,
fala). De cada etapa saem percentis robustos; piso e teto são P5/P95 com limites de plausibilidade
para evitar que um único quadro errado redefina a sua tessitura. O perfil final guarda:

- `floorHz` / `comfortableHz` / `ceilingHz`
- `selfRangeSt` (extensão)
- `centerPosition` (0–1: onde o centro está entre piso e teto)
- forças e desafios em texto, sempre derivados dos dados da própria pessoa

## O que este app nunca vai dizer

- "sua voz é masculina/feminina" — isso é percepção social, não acústica.
- "você atingiu o padrão X" — não há padrão.
- "sua voz está saudável/doente" — não é exame médico.

Se houver dor, fadiga, rouquidão por mais de duas semanas ou perda de extensão, o caminho é
fonoaudiologia/medicina, não um gráfico.
