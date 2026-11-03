/**
 * Fronteira de erro da interface.
 *
 * Antes, uma exceção durante o render (ex.: dado migrado com formato inesperado)
 * derrubava a árvore inteira do React e deixava a janela em branco — sem
 * mensagem, sem saída, e com o usuário achando que perdeu os dados. Agora o app
 * mostra o ocorrido, o caminho do log local e um botão para recarregar a
 * interface sem fechar o aplicativo (os dados já gravados continuam intactos).
 */
import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string;
  reloading: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: '', reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Nunca envia áudio nem conteúdo de anotações: só a mensagem técnica.
    const context = `ErrorBoundary ${info.componentStack?.slice(0, 300) ?? ''}`;
    console.error('[prisma] erro de interface:', error);
    void window.prisma?.logError({ message: error.message, stack: error.stack, context });
    this.setState({ info: context });
  }

  private reload = (): void => {
    this.setState({ reloading: true });
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error, info, reloading } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app-shell" style={{ display: 'block', padding: 'var(--sp-6)' }}>
        <div className="card" style={{ maxWidth: 720, margin: '0 auto' }}>
          <h1 className="h1" style={{ fontSize: 'var(--fs-xl)', marginBottom: 'var(--sp-3)' }}>
            A interface encontrou um erro
          </h1>
          <p className="lead" style={{ marginTop: 0 }}>
            O aplicativo continua aberto e <strong>seus dados salvos não foram afetados</strong>.
            Recarregue a interface para voltar ao normal — se o erro se repetir, exporte um backup
            em Configurações → Dados antes de reiniciar.
          </p>

          <div className="banner danger" style={{ marginBottom: 'var(--sp-4)' }}>
            <span style={{ flex: 1 }} className="mono">
              {error.message || 'Erro desconhecido'}
            </span>
          </div>

          <div className="row wrap">
            <button className="btn primary" onClick={this.reload} disabled={reloading}>
              {reloading ? 'Recarregando…' : 'Recarregar interface'}
            </button>
            <button className="btn ghost" onClick={() => window.location.reload()}>
              Reabrir do zero
            </button>
          </div>

          <p className="hint" style={{ marginTop: 'var(--sp-4)' }}>
            Detalhes técnicos ficam no log local do aplicativo (não enviamos nada para a internet).
            Caminho do log: Configurações → Sobre.
            {info ? ` Origem: ${info.slice(0, 160)}` : ''}
          </p>
        </div>
      </div>
    );
  }
}
