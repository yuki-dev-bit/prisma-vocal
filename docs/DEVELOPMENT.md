# Desenvolvimento

## Ambiente

- Node.js 22.12 ou mais novo (o `engines` do `package.json`), npm ≥ 10 — o CI roda em 22 e 24
- Python 3 + Pillow apenas para `npm run icons`
- Chromium via Playwright apenas para `npm run screenshots`
- Linux precisa das bibliotecas de áudio/gráficas do Electron (`libasound2`, `libnss3`, etc.)

```bash
npm install
npm run verify     # typecheck + testes (não precisa de microfone)
npm run dev        # Electron com HMR
npm run dev:web    # só renderer em http://localhost:5273
```

## Mapa do código

| Quero mexer em… | Vá para |
| --- | --- |
| DSP (f0, formantes, HNR) | `src/core/dsp/` |
| como uma sessão é agregada | `src/core/analysis/analyzer.ts` |
| texto/estrutura das aulas | `src/core/training/curriculum.ts` |
| como metas são avaliadas | `src/core/training/evaluate.ts` |
| mensagens de feedback | `src/core/feedback/engine.ts` |
| protocolo de avaliação | `src/core/assessment/profile.ts` |
| telas | `src/renderer/views/` |
| HUD/gráficos | `src/renderer/components/hud/` |
| estado global | `src/renderer/state/store.tsx` |
| captura de áudio | `src/audio/AudioEngine.ts`, `src/audio/capture-processor.js` |
| janela, CSP, permissões | `electron/main.ts` |
| persistência cifrada | `electron/storage/SecureStore.ts`, `electron/ipc.ts` |

## Regras do projeto

1. `src/core` é puro: sem React, sem Electron, sem `window`, sem `Date.now` em cálculo de métricas.
2. Nada de áudio atravessa o IPC. Se precisar persistir, persista PCM cifrado em `SecureStore`.
3. Toda entrada vinda do renderer é não confiável: valide tipo, faixa e tamanho no processo principal.
4. Texto de interface em pt-BR (chaves em `src/core/i18n/pt-BR.ts`); não hardcode strings em views.
5. Nunca mostrar 0 onde não há medida — use `null` e renderize "—" / "sem nota".
6. Se mudar DSP, atualize `docs/METRICS.md` e adicione teste.

## Adicionar uma aula

```ts
// src/core/training/curriculum.ts, dentro do array do módulo
{
  id: 'fund-resp-3',
  moduleId: 'fundamentos',
  title: 'Frase curta com fluxo estável',
  objective: '…',
  why: '…',
  level: 1,
  estimatedMinutes: 7,
  exercises: [
    {
      id: 'fund-resp-3-1',
      title: '…',
      kind: 'fala',            // 'sustentado' | 'fala' | 'livre'
      durationSec: 30,
      steps: ['…', '…', '…'],
      cue: '…',
      targets: [
        { metric: 'f0Stability', comparator: 'gte', value: 70, relativeTo: 'absolute' },
      ],
      pitfalls: ['…'],
    },
  ],
}
```

Regras: `id` do módulo é prefixo da lição; metas relativas (`relativeTo: 'baseline'`) usam a linha de
base do perfil. Depois de editar, rode `npm test` (há testes que validam ids e metas do currículo).

## Verificações automatizadas

| Comando | O que cobre | Precisa de |
| --- | --- | --- |
| `npm test` | DSP, análise, progresso, relatórios, calibração, manifesto Android e núcleo do Electron | Node |
| `npm run smoke` | caminho de inicialização + CSP de desenvolvimento | Node |
| `npm run smoke:desktop` | Electron real: startup do bundle, fechamento com descarga, reabertura | display (`xvfb-run` no Linux) |
| `npm run smoke:mic` | captura, calibração e persistência em Chromium com microfone sintético | Node |
| `npm run perf:hud` | fps, long tasks, layouts e CPU do HUD ao vivo (CPU 4× mais lenta) | `build:renderer` antes |
| `npm run lint` | ESLint (typescript-eslint + regras de hooks) | nada |
| `npm run format` / `format:check` | Prettier nos fontes; `--check` é o que o CI usa | nada |
| `npm run test:coverage` | testes + cobertura de `src/core` e `src/shared` com piso | nada |

A cobertura é medida só em `src/core/**` e `src/shared/**` — o que os testes de Node exercitam de

Medido hoje: **97,9% statements, 91,5% branches, 99,6% funções, 99,5% linhas**. O piso em
`vitest.config.ts` fica ~2 pontos abaixo (95/88/97/97): subir o número exige teste novo, e baixar o
piso exige justificativa no PR.

O que fica fora do relatório, com o motivo — e nada além disso:

- `src/shared/types.ts`: só declarações de tipo, zero linha executável. Apareceria como 0% por
  construção, não por falta de teste.
- `electron/`, o AudioWorklet (`src/audio/worklet.ts`) e o bridge Android: não carregam em Node.
- A interpolação de `{variáveis}` do `translator`: nenhuma string do dicionário usa placeholder hoje.
  O teste `settings-i18n.test.ts` falha de propósito se alguém adicionar um `{x}` sem escrever o
  teste de interpolação correspondente.

Regra de revisão: número alto de cobertura não substitui asserção. Se um teste novo quebra, corrija o
código (e conte o que era o defeito) — não afrouxe o teste. Truques recusados neste projeto:
`/* v8 ignore */`, `exclude` de módulo com lógica, `include` de um único arquivo, piso em zero e
teste sem `expect`.

## Testar áudio sem microfone

`tests/helpers/synth.ts` gera vogais sintéticas, senoides, ruído e silêncio. Para testar ponta a
ponta com um "microfone" simulado no navegador:

```bash
npm run dev:web
npm run screenshots   # usa Chromium com --use-file-for-fake-audio-capture
```

`assets/dev/voz-sintetica.wav` é gerado pelo próprio fluxo de capturas (ou por qualquer WAV 48 kHz).

## Debug do HUD

- O ring buffer (`LiveBuffer`) é acessível pelo objeto retornado por `useLiveSession()`; `latest`
  mostra o último quadro.
- Se um gráfico não desenha, verifique `useCanvas`: DPR, `ResizeObserver` e o `redraw` retornado.
- Movimento reduzido throttla para ~12 fps — espere menos fluidez ao testar com essa opção ligada.

## Estilo de código

- TypeScript `strict`, sem `any` implícito; `tsc --noEmit` é parte do `verify`.
- Comentários explicam **por quê**, não o quê. Sem comentários óbvios.
- Nomes de domínio em português quando são conceitos do produto (`aula`, `tomada`, `piso`, `teto`);
  código/infra em inglês.
- Sem dependências novas no renderer sem justificar tamanho e licença.
