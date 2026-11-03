# Prisma Vocal 1.0.1

Treino e análise de voz **offline** para Windows. Nada sai do seu computador: sem conta, sem
nuvem, sem telemetria.

Esta versão é sobre **fluidez**: o HUD ao vivo deixou de saturar o processador.

## O que mudou

- **HUD fluido no celular e no PC.** A reamostragem do áudio (44,1/48 kHz → 16 kHz, a cada 16 ms)
  recalculava os coeficientes do filtro com `sin`/`cos` para cada amostra — cerca de 9 milhões de
  funções trigonométricas por segundo no thread principal. Os coeficientes agora são calculados uma
  vez por fase de leitura e reaproveitados.
- Medido com CPU 4× mais lenta (aproximação de celular de faixa média): de **~13 fps para ~55 fps**,
  quadro p95 de **140 ms para ~28 ms**, e o analisador ao vivo caiu de **22,7 % para 6,9 %** de um
  núcleo em 44,1 kHz. No PC, o custo de CPU do HUD caiu de ~49 % para ~10 % de um núcleo.
- Gráficos do HUD redesenhados por dentro: grade e rótulos desenhados uma vez, trilha de formantes
  agrupada em 16 traços (era um por segmento), espectrograma escrevendo direto nos pixels, medidor
  de nível sem recriar 28 elementos por atualização.
- Plano de formantes: o título do eixo F2 não encosta mais no rótulo do último tick.

Detalhes e números completos em `docs/DIAGNOSTICO-HUD.md`. Para medir na sua máquina:
`npm run perf:hud`.

## Baixar e instalar

| Arquivo | O que é |
| --- | --- |
| `Prisma Vocal-1.0.1-win-x64.exe` | Instalador (NSIS), Windows 10/11 64 bits |
| `SHA256SUMS.txt` | Hash para conferir a integridade do download |

1. Baixe o `.exe` e o `SHA256SUMS.txt`.
2. Confira o hash (opcional, mas recomendado). O formato do `SHA256SUMS.txt` é
   `hash` + dois espaços + nome do arquivo, que é o que o `Get-FileHash` imprime:

   ```powershell
   $exe = 'Prisma Vocal-1.0.1-win-x64.exe'
   (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLower() + '  ' + $exe
   Get-Content -LiteralPath .\SHA256SUMS.txt
   ```

   As duas linhas precisam ser iguais. (`certutil -hashfile` não serve aqui: ele imprime cabeçalho,
   hash e rodapé, e não o formato do arquivo.)

3. Execute o instalador. **O binário não tem assinatura de código** (certificado é pago), então o
   Windows vai mostrar o SmartScreen: **Mais informações → Executar assim mesmo**.

Não é necessária nenhuma conta, nenhuma chave de licença e nenhuma conexão com a internet. O app
não faz requisições de rede — por construção, não por promessa: não existe `fetch`, `WebSocket`
nem `eval` no código.

## Atualizando de 1.0.0

Instale por cima: perfil, diário, progresso e gravações em `%APPDATA%\Prisma Vocal\` são
preservados (o instalador não apaga dados de usuário).

## Primeira execução (4 minutos)

1. **Avaliação** — 7 etapas curtas. Cria o seu perfil (piso, centro, teto, extensão) e calibra as
   metas dos exercícios.
2. **Configurações → Áudio → Testar entrada** — fale e ajuste o **ganho** até o pico ficar entre
   **−12 e −6 dBFS**. Evite "clipping".
3. **Início → Praticar agora** — segue o próximo passo recomendado.
4. **Analisar** — grave uma tomada de 5 a 10 s para guardar sua linha de base.

## O que o app mede

Frequência fundamental (YIN), formantes, ressonância relativa, brilho, HNR, soprosidade e nível.
Tudo em tempo real, com o microfone do sistema.

- As medidas são **estimativas acústicas** para acompanhar a sua evolução, não um diagnóstico.
- Ressonância e brilho são valores **relativos**: trocar de microfone desloca os números. Compare
  tomadas feitas com o mesmo microfone e na mesma distância.

## Onde ficam seus dados

`%APPDATA%\Prisma Vocal\` — perfil, diário e gravações (`recordings\*.enc`) criptografados, com a
chave protegida pelo DPAPI do Windows. Backup em JSON (sem áudio) está em Configurações → Dados.
"Apagar tudo" está em Privacidade.

## Requisitos

- Windows 10 ou 11, 64 bits.
- Microfone funcional (qualquer um serve para começar).
- ~150 MB de disco.

## Limitações conhecidas

- O instalador e o uso com microfone real **não foram testados em hardware por quem escreveu** — o
  typecheck, o lint, os 351 testes com piso de cobertura e o build rodam no CI (Ubuntu e Windows,
  Node 22 e 24). Os números de desempenho desta versão foram medidos no Chromium com o bundle de
  produção e limitação de CPU por software, não no `.exe` em um PC real nem em um aparelho Android
  real. Se algo falhar, abra uma issue com o modelo do microfone e o log de
  `%APPDATA%\Prisma Vocal\logs\`.
- Não substitui fonoaudiólogo(a) nem avalia saúde vocal. Dor, rouquidão por mais de duas semanas,
  perda de extensão ou fadiga constante: procure atendimento profissional.
- macOS e Linux são suportados pela configuração, mas os pacotes desta versão são só Windows.

## Código

Fonte completa nesta release (tag `v1.0.1`), licença MIT. Electron 45 + React 19 + Vite 8 +
TypeScript estrito, com DSP próprio em `src/core/dsp/`.
