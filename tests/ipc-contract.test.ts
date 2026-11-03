import { describe, expect, it } from 'vitest';
import { IPC } from '@shared/ipc-contract';

const canais = Object.entries(IPC);

describe('contrato de IPC', () => {
  it('todos os canais seguem o padrão namespace:acao', () => {
    for (const [, canal] of canais) {
      expect(canal).toMatch(/^(data|rec|sys|app):[a-z-]+$/);
    }
  });

  it('não há canal repetido', () => {
    const valores = canais.map(([, c]) => c);
    expect(new Set(valores).size).toBe(valores.length);
  });

  it('cada chave tem valor próprio e não vazio', () => {
    for (const [chave, canal] of canais) {
      expect(chave).toMatch(/^[a-z][A-Za-z]+$/);
      expect(canal.length).toBeGreaterThan(3);
    }
  });

  it('mantém os canais que a UI usa para descarregar dados ao fechar', () => {
    expect(IPC.flushRequest).toBe('app:flush-request');
    expect(IPC.flushDone).toBe('app:flush-done');
    expect(IPC.loadData).toBe('data:load');
  });
});
