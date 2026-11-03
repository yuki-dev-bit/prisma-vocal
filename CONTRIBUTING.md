# Contribuindo com o Prisma Vocal

Obrigado pelo interesse. Este projeto trata de voz e identidade; algumas contribuições exigem mais
cuidado que o normal, e é sobre isso que este documento fala.

## Formas de ajudar

- **Bugs de DSP**: descreva o caso (f0, tipo de voz, microfone) e, se possível, anexe um WAV
  sintético que reproduza — não envie gravações pessoais sem necessidade.
- **Acessibilidade**: testes com leitor de tela, contraste, teclado, zoom; qualquer barreira é bug.
- **Tradução**: interface (pt-BR/en) e revisor de linguagem do conteúdo.
- **Conteúdo do currículo**: aulas, cues e feedback. Preferimos textos curtos, concretos e sem
  promessas estéticas.
- **Documentação**: README, METRICS, PRIVACY — clareza é funcionalidade.

## Antes de abrir um PR

```bash
npm install
npm run verify     # tsc strict + ESLint + Prettier + testes com cobertura + smokes
npm run build      # garante que o bundle do renderer e do main compilam
```

Checklist:

- [ ] `npm run verify` passa (inclui lint, formatação e piso de cobertura).
- [ ] Se mudou DSP: teste novo **e** atualização de `docs/METRICS.md`.
- [ ] Se mudou texto de UI: chave em `src/core/i18n/pt-BR.ts` (+ `en.ts`) e nada hardcoded.
- [ ] Se mudou IPC: validação de payload no processo principal e tipos em `src/shared/ipc-contract.ts`.
- [ ] Nenhuma dependência nova sem justificativa no PR (tamanho, licença, manutenção).
- [ ] Sem chamadas de rede. O app é offline por definição.

## Diretrizes de conteúdo (importante)

- Fale de **voz**, não de identidade: nada de "voz de mulher de verdade", "passar", "voz correta".
- Não prometa resultados estéticos; descreva o que a prática faz acusticamente.
- Não diagnostique. Se o tema é saúde vocal, encaminhe para profissional.
- Evite gênero/idade como proxy de voz; use descritores acústicos (peso, brilho, f0, ressonância).
- Metas sempre relativas à linha de base da própria pessoa; nunca a números absolutos "ideais".
- Pessoas trans são o público, não o tema de curiosidade: revise o tom.

## Processo

1. Abra uma issue descrevendo o problema (ou o "porquê" da mudança).
2. Faça fork, branch a partir de `main`, commits pequenos e descritivos.
3. PR com: o que muda, como testar, e capturas quando for visual.
4. Revisão: um mantenedor aprova; mudanças de DSP precisam de segunda leitura.

## Código de conduta

Ambiente respeitoso, sem misoginia, racismo, capacitismo, LGBTfobia ou comentários sobre corpos de
outras pessoas. Discussão técnica firme é bem-vinda; desrespeito não. Mantenedores podem remover
contribuições e bloquear contas que insistirem.
