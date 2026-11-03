# Windows: rodar, empacotar e resolver problemas

Guia específico para Windows 10/11. O app foi construído e verificado em Linux; os passos abaixo são
os que faltam para você validar a versão Windows na sua máquina.

## 1. Instalar os pré-requisitos

| Item | Como instalar | Verificação |
| --- | --- | --- |
| Node.js **22.12+** (recomendado: 22 ou 24 LTS) | instalador `.msi` em <https://nodejs.org> | `node -v` e `npm -v` |
| Git para Windows | <https://git-scm.com/download/win> (inclui Git Credential Manager) | `git --version` |
| (opcional) GitHub CLI | `winget install GitHub.cli` | `gh --version` |

Não é necessário Visual Studio, Python nem compilador: todas as dependências são binários prontos.

## 2. Descompactar e rodar

### 2.0 Se `npm install` avisar que scripts de instalação foram bloqueados

Versões recentes do npm bloqueiam `postinstall` de dependências. O sintoma aparece depois, ao rodar
o app, como erro obscuro — porque o **binário do Electron nunca foi baixado**:

```
npm warn install-scripts   electron@45.x (postinstall: node install.js)
npm warn install-scripts   esbuild@0.x (postinstall: node install.js)
```

Corrija com:

```powershell
npm install-scripts approve electron esbuild
npm rebuild electron
npm run doctor        # deve dizer: "tudo certo: Node, Vite e Electron prontos."
```

O `npm rebuild electron` baixa ~120 MB. Se `npm install-scripts` não existir na sua versão do npm,
use `npm install --ignore-scripts=false`.

### 2.1 Se o PowerShell bloquear comandos (`npm.ps1 ... execução de scripts foi desabilitada`)

O `npm` instalado pelo Node.js é um script `.ps1`, e o Windows vem com a política de execução em
`Restricted`. Duas saídas:

```powershell
# Opção A (recomendada): permite scripts locais assinados, por usuário
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

# Opção B (sem mexer na política): chame npm.cmd explicitamente
npm.cmd install
npm.cmd run dev
```

Se `Set-ExecutionPolicy` recusar com "definida por política de grupo", a máquina é gerenciada (ou há
política corporativa): use a Opção B, o **Git Bash** ou o `cmd.exe` — nesses dois o `npm` resolve
para `npm.cmd` e funciona normalmente.

### 2.2 Se `Expand-Archive` disser que o arquivo não existe

Descubra onde o navegador salvou (a pasta Downloads pode estar redirecionada para o OneDrive):

```powershell
Get-ChildItem $HOME -Filter *prisma-vocal*.zip -Recurse -Depth 3 -ErrorAction SilentlyContinue |
  Select-Object FullName, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
```

Se o arquivo veio da internet, ele pode estar marcado como bloqueado:

```powershell
Unblock-File -LiteralPath "<caminho-do-zip>"
```

### 2.3 Descompactar

No PowerShell:

O zip tem os arquivos na raiz (sem pasta extra dentro), então extraia direto para a pasta final:

```powershell
New-Item -ItemType Directory -Force -Path $HOME\dev | Out-Null
Expand-Archive -LiteralPath "<caminho-do-zip>" -DestinationPath $HOME\dev\prisma-vocal -Force
cd $HOME\dev\prisma-vocal
Get-ChildItem            # deve mostrar package.json, src, electron, docs

npm install        # ~2 min, baixa o Electron para Windows (~120 MB)
npm run verify     # typecheck + lint + 351 testes — não precisa de microfone
npm run dev        # abre a janela do app
```

Caminhos com espaço ou OneDrive sincronizado funcionam, mas podem deixar o `npm install` lento.
Se puder, use algo como `C:\dev\prisma-vocal`.

## 3. Permissão de microfone

Windows bloqueia microfone para apps de desktop por padrão em algumas configurações:

**Configurações → Privacidade e segurança → Microfone**
- "Acesso ao microfone" → ativado
- "Permitir que aplicativos da área de trabalho acessem seu microfone" → ativado

Depois, no app: **Configurações → Áudio → Testar entrada**. Se o nível não se mover, verifique
também **Sons → Entrada** (dispositivo padrão) e desative efeitos de "aprimoramento de áudio" do
driver quando possível — eles distorcem HNR e inclinação espectral.

O app **desliga de propósito** `echoCancellation`, `noiseSuppression` e `autoGainControl` do
Chromium, porque esses filtros alteram as medidas acústicas. O "portão de ruído" do app é próprio e
fica em **Configurações → Áudio**.

## 4. Gerar o instalador do Windows

```powershell
npm run dist:win -- --x64   # -> release\Prisma Vocal-1.0.1-win-x64.exe (NSIS)
```

Notas:

- O pacote não é assinado digitalmente (não há certificado no projeto). Ao executar, o Windows
  mostra "O Windows protegeu o computador" → **Mais informações → Executar assim mesmo**. Para
  distribuir de forma séria, compre um certificado de assinatura de código e configure
  `win.certificateFile`/`certificatePassword` (ou assinatura por hardware token).
- Se o `electron-builder` falhar ao extrair `winCodeSign` com erro de *symlink privilege*, ative o
  **Modo de Desenvolvedor** (Configurações → Sistema → Para desenvolvedores) ou rode o terminal como
  administrador.
- Antivírus/EDR pode bloquear o passo que empacota o `.exe`; adicione a pasta `release\` às exceções.

## 5. Onde ficam os dados

```
%APPDATA%\Prisma Vocal\
├── app-data.enc        dados (perfil, sessões, diário, metas) — AES-256-GCM
├── vault.key           chave, protegida por DPAPI (safeStorage)
├── recordings\*.enc    gravações
└── logs\*.log          logs técnicos (sem áudio, sem diário)
```

"Configurações → Dados" mostra o caminho exato e exporta backup em JSON (sem áudio).
"Privacidade → Apagar tudo" remove tudo com confirmação.

## 6. Problemas comuns

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| Janela em branco | build do renderer ausente em modo produção | `npm run build` ou use `npm run dev` |
| Áudio não inicia, erro "AudioWorklet indisponível" | versão antiga do Electron/navegador | confirme `npm install` completo (Electron 38) |
| F0 oscilando entre valores | microfone com AGC/efeitos do driver | desative "aprimoramento" do dispositivo; ajuste ganho para pico entre −12 e −6 dBFS |
| Clipping constante | ganho alto ou microfone perto da boca | reduza o ganho em Configurações → Áudio |
| `npm install` muito lento | proxy/antivírus inspecionando pacotes | `npm config set registry https://registry.npmjs.org/` e libere `node_modules` no antivírus |
| Porta 5273 ocupada | outra instância | `npm run dev:web -- --port 5300` |

## 7. Validar e reportar

Se algo falhar no Windows, ajude o projeto abrindo uma issue com:

- saída de `node -v`, `npm -v` e versão do app (Configurações → Dados);
- modelo do microfone e se é USB/analógico;
- trecho relevante de `%APPDATA%\Prisma Vocal\logs\` (revise antes: não há áudio nem diário, mas
  pode haver caminho de arquivo);
- passos para reproduzir.

Isso é exatamente o que `docs/LIMITATIONS.md` chama de pendência: a versão Windows ainda não foi
executada em hardware real.

### 2.4 A janela abre, mas a interface não carrega (tela escura/vazia)

Sintoma: a janela do Electron aparece, nada é renderizado, e abrir `http://localhost:5273`
no navegador funciona.

Isso acontecia quando a CSP de produção vazava para o dev server: o `@vitejs/plugin-react`
injeta o preâmbulo do React Refresh como script inline e o HMR usa WebSocket, e a política
`script-src 'self'` + `connect-src 'self'` bloqueava os dois. A correção separa as políticas
(`CSP_DEV` no processo principal e o plugin `devCsp` no `vite.config.ts`) — o bundle de
produção continua estrito.

Se acontecer de novo, o terminal agora mostra a causa:

```text
[renderer:error] Executing inline script violates ... 'script-src 'self''
[dev] interface montada: NÃO (0 nós em #root)
```

`npm run smoke` reprova o build nesse caso (sobe o Vite de verdade e confere a CSP servida).

Nota: o `npm run smoke` **não** exige o binário do Electron — ele valida o encadeamento dos
scripts (`npm run dev -- --check`) e a CSP servida pelo Vite. O binário só é exigido por
`npm run dev` e `npm run doctor` (modo `--strict`).
