/**
 * Reamostragem por kernel windowed-sinc (Blackman), com corte anti-alias
 * ajustado ao fator de conversão. Estateless: recebe um bloco e devolve o
 * bloco reamostrado — o que simplifica o pipeline de análise e evita
 * acumular estado entre quadros.
 *
 * Custo: este é o ponto mais quente do app em tempo real (2.048 amostras de
 * saída a cada 16 ms). O kernel de cada amostra depende só da **fase** da
 * posição de leitura (`t - floor(t)`) e do índice do tap — nunca do sinal. Com
 * taxas inteiras a fase assume no máximo `fsOut / mdc(fsIn, fsOut)` valores
 * (1 em 48 kHz→16 kHz, 160 em 44,1 kHz→16 kHz), então os coeficientes de cada
 * fase são calculados uma vez por combinação de taxas e reaproveitados entre
 * blocos. Sem isso eram ~9 milhões de `sin`/`cos` por segundo no thread
 * principal — o app inteiro ficava a 13 fps no Android.
 */

const TAPS = 24;
/** Teto de fases em cache: acima disso o kernel é calculado na hora. */
const MAX_PHASES = 512;
/** Teto de bancos (combinações de taxa) em cache. */
const MAX_BANKS = 8;

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function blackman(x: number): number {
  // x em [-1, 1]
  const t = (x + 1) * 0.5;
  return 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
}

/**
 * Preenche `out` com os coeficientes do kernel de uma fase de leitura.
 * `out[j]` corresponde ao tap `k = j - half + 1`.
 */
function kernelCoeffs(frac: number, half: number, h: number, out: Float32Array): void {
  for (let j = 0; j < out.length; j++) {
    const d = frac - (j - half + 1);
    out[j] = h * sinc(h * d) * blackman(d / half);
  }
}

interface Band {
  /** Coeficientes por fase; `null` = ainda não calculado. */
  readonly phases: (Float32Array | null)[];
  readonly step: number;
  readonly half: number;
  readonly h: number;
  readonly taps: number;
}

const banks = new Map<string, Band>();

function bandFor(fsIn: number, fsOut: number, taps: number): Band | null {
  const step = gcd(fsIn, fsOut);
  const count = fsOut / step;
  if (count > MAX_PHASES) return null;
  const key = `${fsIn}|${fsOut}|${taps}`;
  let band = banks.get(key);
  if (!band) {
    if (banks.size >= MAX_BANKS) banks.clear();
    band = {
      phases: new Array<Float32Array | null>(count).fill(null),
      step,
      half: Math.floor(taps / 2),
      h: 2 * (0.5 * Math.min(1, fsOut / fsIn) * 0.94),
      taps,
    };
    banks.set(key, band);
  }
  return band;
}

/** Limpa o cache de coeficientes (usado em testes e ao trocar de dispositivo). */
export function clearResampleCache(): void {
  banks.clear();
}

/**
 * Reamostra `input` de `fsIn` para `fsOut`.
 * Retorna Float32Array com `floor(input.length * fsOut / fsIn)` amostras.
 */
export function resampleBlock(
  input: Float32Array,
  fsIn: number,
  fsOut: number,
  taps = TAPS,
): Float32Array {
  if (fsIn === fsOut) return input.slice();
  if (input.length === 0) return new Float32Array(0);
  const ratio = fsIn / fsOut;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(Math.max(0, outLen));
  const cutoff = 0.5 * Math.min(1, fsOut / fsIn) * 0.94; // ciclos por amostra de entrada
  const half = Math.floor(taps / 2);
  const h = 2 * cutoff;
  // Taxas inteiras (todas as reais) → banco de fases indexado por `resto / mdc`.
  const band =
    Number.isInteger(fsIn) && Number.isInteger(fsOut) ? bandFor(fsIn, fsOut, taps) : null;
  const scratch = new Float32Array(taps);
  let lastIndex = -1;
  let lastCoeffs: Float32Array = scratch;

  for (let n = 0; n < outLen; n++) {
    let center: number;
    let frac: number;
    let index = -1;
    if (band) {
      // t = n·fsIn/fsOut em aritmética inteira: a fase não acumula erro e se
      // repete exatamente a cada ciclo.
      const prod = n * fsIn;
      const rest = prod % fsOut;
      center = (prod - rest) / fsOut;
      frac = rest / fsOut;
      index = rest / band.step;
    } else {
      const t = n * ratio;
      center = Math.floor(t);
      frac = t - center;
    }

    if (band && index !== lastIndex) {
      let coeffs = band.phases[index];
      if (!coeffs) {
        kernelCoeffs(frac, half, h, scratch);
        coeffs = scratch.slice();
        band.phases[index] = coeffs;
      }
      lastCoeffs = coeffs;
      lastIndex = index;
    } else if (!band) {
      kernelCoeffs(frac, half, h, scratch);
      lastCoeffs = scratch;
    }

    const first = center - half + 1; // índice de entrada do tap 0
    const from = Math.max(0, -first);
    const to = Math.min(taps - 1, input.length - 1 - first);
    let acc = 0;
    let norm = 0;
    for (let j = from; j <= to; j++) {
      const coeff = lastCoeffs[j];
      acc += input[first + j] * coeff;
      norm += coeff;
    }
    out[n] = norm !== 0 ? acc / norm : 0;
  }
  return out;
}
