/**
 * Versão exibida pelo app.
 *
 * Fonte única: antes o número aparecia solto em três lugares (ponte Electron,
 * ponte Android e rodapé da navegação) e podia divergir do `package.json` na
 * hora de publicar. `tests/version.test.ts` garante que este valor acompanha o
 * `package.json`.
 */
export const APP_VERSION = '1.0.1';
