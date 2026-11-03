import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Configuração exclusiva dos testes: ambiente Node puro (sem DOM), sem plugins.
// O núcleo (`src/core`) não deve depender de DOM nem de Electron — os testes
// garantem isso na prática.
export default defineConfig({
  resolve: {
    alias: {
      '@core': r('./src/core'),
      '@shared': r('./src/shared'),
      '@audio': r('./src/audio'),
      '@renderer': r('./src/renderer'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      // Medimos o que os testes de Node realmente exercitam: o núcleo puro.
      // O renderer é coberto pelos smokes em Chromium (`npm run smoke:mic`,
      // `test:mobile`), não por cobertura de linha.
      include: ['src/core/**/*.ts', 'src/shared/**/*.ts'],
      // `shared/types.ts` é só declaração de tipos (nenhuma linha executável),
      // então aparece como 0% por construção, não por falta de teste. Fora da
      // conta — e apenas ele: nada de esconder módulo com lógica.
      exclude: ['**/*.d.ts', 'src/shared/types.ts'],
      // Piso ~2 pontos abaixo do medido (97,9% stmts / 91,5% branches / 99,6%
      // funções / 99,5% linhas). Serve para pegar regressão, não como meta.
      // O que fica de fora da conta, e por quê:
      //  • `src/shared/types.ts` — só declarações de tipo, zero linha executável;
      //  • o processo principal do desktop, o AudioWorklet e o bridge nativo —
      //    não existem no ambiente Node de teste; são cobertos por
      //    `smoke:desktop`, `smoke:android`, `smoke:mic` e `test:mobile`;
      //  • a interpolação de variáveis do `translator` (i18n) — nenhuma string
      //    atual usa `{placeholder}`; há teste que falha se alguém adicionar uma
      //    sem escrever o teste correspondente.
      thresholds: { statements: 95, branches: 88, functions: 97, lines: 97 },
    },
  },
});
