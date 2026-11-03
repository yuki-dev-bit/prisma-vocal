# Privacidade

## Resumo em uma linha

O áudio é analisado no seu computador, as gravações ficam cifradas no disco e o app não tem código
de rede no renderer.

## O que é coletado

| Dado | Onde fica | Cifrado? |
| --- | --- | --- |
| Métricas de sessão (f0, HNR, ressonância, etc.) | `app-data.enc` no diretório de dados | Sim (AES-256-GCM) |
| Perfil vocal e avaliação | `app-data.enc` | Sim |
| Diário vocal (texto livre) | `app-data.enc` | Sim |
| Metas e progresso | `app-data.enc` | Sim |
| Gravações de áudio | `recordings/*.enc` | Sim (AES-256-GCM, IV por arquivo) |
| Configurações | `app-data.enc` | Sim |
| Logs técnicos | `logs/*.log` | Não — e **não** contêm áudio nem texto do diário |

Nada é enviado para fora do dispositivo. Não há analytics, crash reporting remoto, conta, login,
sincronização ou atualização automática que faça requisições.

## Chave de criptografia

- Chave aleatória de 32 bytes gerada na primeira execução, por instalação.
- Protegida por `safeStorage` (Keychain no macOS, DPAPI no Windows, libsecret/kwallet no Linux).
- Se o cofre do sistema não estiver disponível, a chave é gravada com permissão `0600` e a UI mostra
  um aviso permanente (a criptografia continua; o que enfraquece é a proteção da chave).
- Perder a chave significa perder as gravações — por isso existe exportação de backup **sem áudio**
  (JSON legível), que pode ser guardada onde você quiser.

## Modelo de ameaça

Protege contra:

- outro usuário da mesma máquina lendo os arquivos;
- backup automático ou sincronização de pasta copiando os dados;
- inspeção casual do conteúdo das gravações.

**Não** protege contra:

- código malicioso rodando como o seu usuário (ele pode ler a chave em memória);
- captura de tela ou gravação de áudio por outro aplicativo;
- alguém com acesso físico e o sistema desbloqueado.

## Modo navegador (`npm run dev:web`)

O navegador usa IndexedDB. **Não há criptografia**, porque não existe `safeStorage` nem processo
principal. A interface exibe um aviso permanente, e as gravações ficam como WAV legíveis no
armazenamento do navegador. Esse modo existe para desenvolvimento e demonstração, não para uso real
com áudio sensível.

## Permissões

- Microfone: pedido na primeira captura, pelo sistema operacional.
- Qualquer outra permissão (câmera, tela, geolocalização, notificações de terceiros) é negada por
  padrão no processo principal.
- Navegação e `window.open` são bloqueados; abrir links externos passa por allowlist
  (`github.com/yuki-dev-bit`).

## Exclusão de dados

- Apagar uma gravação remove o arquivo `.enc` do disco imediatamente.
- "Apagar tudo" (Configurações → Privacidade) remove dados, gravações e chave, com confirmação do
  sistema operacional.
- Retenção automática opcional: `retentionDays` (0 = manter até apagar manualmente).

## Exportações

- **Relatório** (HTML/Markdown): gerado localmente; contém métricas e, se você marcar, diário e
  metas. O arquivo só existe onde você salvar — trate como dado pessoal.
- **Backup** (JSON): perfil, sessões, diário, metas e configurações. Nunca inclui áudio.
- **WAV**: exporta a gravação decifrada; a partir daí ela é um arquivo comum no seu sistema.

## Transparência sobre o conteúdo

Os textos do app (aulas, feedback) falam de voz, não de identidade. Não há coleta de gênero, nome
social ou qualquer dado sensível além do que você digitar voluntariamente no diário — e o diário
fica local.
