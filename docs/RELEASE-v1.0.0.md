# Prisma Vocal 1.0.0

Treino e análise de voz **offline** para Windows. Nada sai do seu computador: sem conta, sem
nuvem, sem telemetria.

## Baixar e instalar

| Arquivo | O que é |
| --- | --- |
| `Prisma Vocal-1.0.0-win-x64.exe` | Instalador (NSIS), Windows 10/11 64 bits |
| `SHA256SUMS.txt` | Hash para conferir a integridade do download |

1. Baixe o `.exe` e o `SHA256SUMS.txt`.
2. Confira o hash (opcional, mas recomendado):

   ```powershell
   $exe = 'Prisma Vocal-1.0.0-win-x64.exe'
   (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLower() + '  ' + $exe
   Get-Content -LiteralPath .\SHA256SUMS.txt
   ```

3. Execute o instalador. **O binário não tem assinatura de código** (certificado é pago), então o
   Windows vai mostrar o SmartScreen: **Mais informações → Executar assim mesmo**.

Não é necessária nenhuma conta, nenhuma chave de licença e nenhuma conexão com a internet. O app
não faz requisições de rede — por construção, não por promessa: não existe `fetch`, `WebSocket`
nem `eval` no código.

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
  typecheck, o lint, os 352 testes com piso de cobertura e o build rodam no CI (Ubuntu e Windows,
  Node 22 e 24). Se algo falhar,
  abra uma issue com o modelo do microfone e o log de `%APPDATA%\Prisma Vocal\logs\`.
- Não substitui fonoaudiólogo(a) nem avalia saúde vocal. Dor, rouquidão por mais de duas semanas,
  perda de extensão ou fadiga constante: procure atendimento profissional.
- macOS e Linux são suportados pela configuração, mas os pacotes desta versão são só Windows.

## Código

Fonte completa nesta release (tag `v1.0.0`), licença MIT. Electron 45 + React 19 + Vite 8 +
TypeScript estrito, com DSP próprio em `src/core/dsp/`.
