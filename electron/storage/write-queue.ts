/**
 * Fila de escrita por arquivo (módulo puro, sem Electron).
 *
 * Bug que motivou: `SecureStore.writeAtomic` usava `${file}.tmp-${pid}` como
 * arquivo temporário. Duas gravações simultâneas — o que passou a acontecer com
 * a gravação imediata da calibração somada ao debounce dos dados — escreviam no
 * MESMO temporário: uma podia renomear o arquivo pela metade da outra, gerando
 * JSON truncado (recuperável pelo .bak, mas com perda da última alteração).
 *
 * A fila serializa as escritas e o nome do temporário ganha um contador único.
 */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private sequence = 0;

  /** Executa `task` depois de todas as anteriores, na ordem de chegada. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // A cauda nunca fica rejeitada: um erro não pode travar as próximas escritas.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Resolve quando não há escrita pendente (usado ao fechar o app). */
  async drain(): Promise<void> {
    await this.tail.then(
      () => undefined,
      () => undefined,
    );
  }

  /** Sufixo único para o arquivo temporário. */
  nextTempSuffix(): string {
    this.sequence += 1;
    return `${process.pid}-${this.sequence}`;
  }

  get pendingSequence(): number {
    return this.sequence;
  }
}
