# Segurança

## Como reportar

Não abra issue pública para vulnerabilidades. Envie um e-mail para
**yuki-dev-bit@users.noreply.github.com** (ou use *Security advisories* do GitHub) com:

- descrição do problema e impacto;
- passos para reproduzir (versão, sistema);
- se possível, um patch sugerido.

Resposta esperada em até 7 dias. Versões suportadas: a última minor publicada.

## Modelo de ameaça

O Prisma Vocal processa áudio de voz — dado sensível. O que ele se compromete a fazer:

1. **Nenhum tráfego de rede no renderer.** Sem telemetria, sem CDN, sem fontes remotas.
2. **Gravações cifradas em repouso** (AES-256-GCM, IV aleatório por arquivo, tag de 16 bytes).
3. **Chave protegida pelo SO** (`safeStorage`); fallback em arquivo `0600` com aviso explícito na UI.
4. **Superfície de privilégio mínima**: `contextIsolation`, `sandbox`, `nodeIntegration: false`,
   preload expondo apenas funções nomeadas (sem `ipcRenderer` cru, sem `fs`).
5. **Permissões negadas por padrão**, exceto microfone.
6. **Navegação bloqueada** (`will-navigate`), `window.open` negado e `openExternal` com allowlist.
7. **Validação no processo principal**: todo payload do renderer é tratado como não confiável (tipo,
   faixa, tamanho, regex de id).

## O que está fora do escopo

- código malicioso rodando com o mesmo usuário (pode ler a chave em memória);
- atacante com acesso físico e sessão desbloqueada;
- captura de tela/áudio por outro aplicativo;
- roubo do backup exportado pelo próprio usuário (JSON em claro, sem áudio).

## Detalhes de implementação relevantes

| Item | Implementação |
| --- | --- |
| Cifra | AES-256-GCM; `createCipheriv`/`createDecipheriv` com IV de 12 bytes aleatório por registro |
| Derivação | chave de 32 bytes aleatória por instalação (`randomBytes`) |
| Escrita | arquivo temporário + `rename` atômico, `.bak` da versão anterior |
| Percurso de caminho | ids de gravação validados por `^[A-Za-z0-9_-]{4,64}$` antes de tocar no disco |
| Limite de entrada | PCM até 12 min (`48000 × 4 × 60 × 12` bytes); relatório até 5 MB |
| CSP | em meta e por header: `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` |
| Logs | rotação local; nunca registram áudio, PCM, texto do diário ou caminho de gravação |

## Boas práticas para quem usa

- Baixe apenas dos releases oficiais; confira `SHA256SUMS`.
- Se o app avisar que a chave não pôde ser protegida pelo cofre do sistema, considere guardar as
  gravações fora do disco (ou usar `privacy.storeRecordings = false`).
- Exporte backup (JSON, sem áudio) periodicamente: perder a chave significa perder as gravações.
- Em máquinas compartilhadas, bloqueie a sessão do sistema — a criptografia não protege um
  aplicativo já aberto.

## Superfícies de confiança no desktop

| Superfície | Controle |
| --- | --- |
| IPC (`window.prisma`) | Só handlers registrados no preload; cada handler valida que a chamada veio da janela principal antes de tocar em disco. |
| Permissão de microfone | Concedida apenas quando a origem é o próprio app (`file://` ou o dev server local); qualquer outra origem é negada e registrada. |
| Navegação | `will-navigate` bloqueia saída do app, `setWindowOpenHandler` nega janelas novas e `<webview>` é recusado explicitamente. |
| Links externos | `openExternal` só abre `https://github.com/yuki-dev-bit` (allowlist, desktop e Android). |
| Fechamento | A janela pede a descarga dos dados ao renderer antes de encerrar — evita perda silenciosa, não amplia acesso. |
