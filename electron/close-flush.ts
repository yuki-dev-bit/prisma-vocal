/**
 * Porta de saída com descarga de dados (módulo puro, sem Electron).
 *
 * Bug que motivou: o renderer grava com debounce de 450 ms e escuta
 * `beforeunload`/`pagehide`. Quando o usuário fecha a janela, o Electron destrói
 * o renderer na hora — a descarga assíncrona não termina e a última alteração
 * (uma meta, a calibração recém-salva) se perde.
 *
 * A porta intercepta o primeiro `close`, pede a descarga ao renderer e só deixa
 * fechar quando a resposta chega — ou quando o prazo estoura, para nunca travar
 * o fechamento do aplicativo.
 */
export interface CloseGate {
  /**
   * Registra uma tentativa de fechamento.
   * Devolve `null` quando já existe uma descarga em andamento (fechar de novo
   * não reinicia o fluxo) e um `Promise` que resolve quando pode fechar.
   */
  request(): Promise<void> | null;
  /** Chamado quando a interface confirma que terminou de gravar. */
  ack(): void;
  readonly isArmed: boolean;
}

export function createCloseGate(timeoutMs = 1500): CloseGate {
  let armed = false;
  let resolvePending: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const settle = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    const resolve = resolvePending;
    resolvePending = null;
    resolve?.();
  };

  return {
    request(): Promise<void> | null {
      if (armed) return null;
      armed = true;
      const promise = new Promise<void>((resolve) => {
        resolvePending = resolve;
      });
      timer = setTimeout(() => {
        // A interface não respondeu: segue o fechamento em vez de pendurar o app.
        settle();
      }, timeoutMs);
      timer.unref?.();
      return promise;
    },
    ack(): void {
      settle();
    },
    get isArmed(): boolean {
      return armed;
    },
  };
}
