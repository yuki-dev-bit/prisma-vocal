/**
 * Currículo de treino vocal: módulos progressivos, aulas e exercícios.
 *
 * O conteúdo é organizado em três trilhas:
 *   • `shared` — fundamentos válidos para qualquer voz e objetivo;
 *   • `mtf`    — feminização vocal;
 *   • `ftm`    — masculinização vocal.
 *
 * Todas as metas são RELATIVAS ao próprio usuário (linha de base medida na
 * avaliação) ou expressas em índices comparativos — nunca em "Hz ideais".
 */
import { Lesson, MetricTarget, TrainingModule } from '../../shared/types';

const t = (
  metric: MetricTarget['metric'],
  op: MetricTarget['op'],
  label: string,
  extra: Partial<MetricTarget> = {},
): MetricTarget => ({
  metric,
  op,
  label,
  weight: extra.weight ?? 1,
  ...extra,
});

/* ------------------------------------------------------------------ */
/* Trilha compartilhada                                                */
/* ------------------------------------------------------------------ */

const fundamentos: Lesson[] = [
  {
    id: 'fund-respiracao',
    moduleId: 'fundamentos',
    mode: 'shared',
    title: 'Apoio respiratório sem excesso',
    objective:
      'Aprender a sustentar uma nota com fluxo de ar estável, sem empurrar a voz nem prender a respiração.',
    why: 'Grande parte da instabilidade de altura e do cansaço vocal vem de fluxo de ar irregular. Um fluxo constante dá base para qualquer mudança de timbre depois.',
    estimatedMinutes: 8,
    level: 1,
    exercises: [
      {
        id: 'fund-resp-1',
        kind: 'sustentado',
        title: 'Sopro contínuo com som leve',
        steps: [
          'Inspire pelo nariz sem levantar os ombros (2 segundos).',
          'Sustente um "sss" fino e constante por 8 segundos.',
          'Repita com "aaa" confortável, mesma duração, mesmo volume do começo ao fim.',
        ],
        durationSec: 30,
        cue: 'Pense em fluxo, não em força. O volume não deve cair no final.',
        pitfalls: [
          'Encher demais o pulmão: gera pressão e aperto na garganta.',
          'Deixar o volume cair 6 dB ou mais no fim da nota.',
        ],
        targets: [
          t('levelStability', '>=', 'Volume estável durante a nota', { value: 65, weight: 1.2 }),
        ],
      },
      {
        id: 'fund-resp-2',
        kind: 'escala',
        title: 'Cinco notas com fluxo igual',
        steps: [
          'Escolha uma nota confortável (o app sugere uma).',
          'Cante/suba cinco notas de uma escala simples em "a", uma por segundo.',
          'Mantenha o volume igual do início ao fim — sem crescer no agudo.',
        ],
        durationSec: 20,
        cue: 'Mesma quantidade de ar em cada nota. Grave não significa mais forte.',
        pitfalls: ['Gritar as notas agudas para "chegar" nelas.', 'Perder o apoio na última nota.'],
        targets: [t('levelStability', '>=', 'Volume constante na escala', { value: 60 })],
      },
    ],
  },
  {
    id: 'fund-higiene',
    moduleId: 'fundamentos',
    mode: 'shared',
    title: 'Aquecimento e saúde vocal',
    objective: 'Criar um aquecimento curto e reconhecer sinais de esforço antes que virem lesão.',
    why: 'Voz é tecido. Aquecer 3 a 5 minutos reduz esforço e melhora o controle fino. Dor, rouquidão persistente ou perda de agudo são sinais de parar — e, se durarem mais de duas semanas, de procurar avaliação profissional.',
    estimatedMinutes: 6,
    level: 1,
    exercises: [
      {
        id: 'fund-hig-1',
        kind: 'glissando',
        title: 'Sirenes suaves',
        steps: [
          'Faça um som de "ng" (como em "mingau") e deslize suavemente para cima e para baixo.',
          'Movimento contínuo, sem degraus, sem esforço.',
          'Três subidas e três descidas lentas.',
        ],
        durationSec: 25,
        cue: 'O som deve vibrar atrás do nariz, leve como um humming.',
        pitfalls: ['Subir até raspar.', 'Aumentar o volume junto com a altura.'],
        targets: [t('voicedRatio', '>=', 'Som contínuo e regular', { value: 0.5 })],
      },
      {
        id: 'fund-hig-2',
        kind: 'livre',
        title: 'Checagem de conforto',
        steps: [
          'Fale uma frase qualquer em volume de conversa.',
          'Note: garganta apertada? mandíbula travada? voz "sumindo" no fim?',
          'Registre no diário vocal como você sentiu a voz hoje.',
        ],
        durationSec: 20,
        cue: 'Sem esforço é o padrão. Se doer, pare e registre.',
        pitfalls: ['Ignorar sinais de esforço para "cumprir" o exercício.'],
        targets: [],
      },
    ],
  },
  {
    id: 'fund-escuta',
    moduleId: 'fundamentos',
    mode: 'shared',
    title: 'Escuta: brilho, peso e altura',
    objective:
      'Separar três dimensões que costumam ser confundidas: altura (f0), peso (contato) e brilho (ressonância).',
    why: 'Quase todo mundo tenta mudar tudo apenas mexendo na altura. Treinar o ouvido para timbre e peso abre caminhos mais eficientes e menos fatigantes.',
    estimatedMinutes: 10,
    level: 1,
    exercises: [
      {
        id: 'fund-esc-1',
        kind: 'comparacao',
        title: 'Mesma nota, dois timbres',
        steps: [
          'Sustente uma nota confortável em "aaa" com timbre mais escuro.',
          'Sustente a MESMA nota com timbre mais claro e frontal.',
          'Compare os gráficos: a altura deve ser parecida; o brilho, diferente.',
        ],
        durationSec: 30,
        cue: 'Altura igual, cor diferente. Isso é ressonância.',
        pitfalls: ['Mudar a altura junto com o timbre sem perceber.'],
        targets: [
          t('f0Stability', '>=', 'Manter a mesma altura nos dois timbres', { value: 60 }),
          t('resonanceIndex', '>=', 'Registrar brilho diferente do habitual', {
            value: 1,
            relative: 'baselineBrightness',
          }),
        ],
      },
    ],
  },
];

const mapeamento: Lesson[] = [
  {
    id: 'mapa-tessitura',
    moduleId: 'mapeamento',
    mode: 'shared',
    title: 'Onde sua voz vive',
    objective: 'Identificar piso, teto e centro confortável — a partir disso, tudo é proporcional.',
    why: 'Sem saber seu mapa, qualquer meta vira comparação com outra pessoa. Com o mapa, "subir 2 semitons" é um passo mensurável e justo.',
    estimatedMinutes: 9,
    level: 2,
    exercises: [
      {
        id: 'mapa-1',
        kind: 'glissando',
        title: 'Mapa de extensão',
        steps: [
          'Deslize do confortável até o grave confortável e volte.',
          'Deslize do confortável até o agudo confortável e volte.',
          'Compare com a última avaliação no histórico.',
        ],
        durationSec: 40,
        cue: 'Sem esforço nos extremos. O mapa é do dia de hoje.',
        pitfalls: ['Forçar o extremo para "melhorar o número".'],
        targets: [t('f0RangeSt', '>=', 'Usar pelo menos 8 semitons de extensão', { value: 8 })],
      },
      {
        id: 'mapa-2',
        kind: 'fala',
        title: 'Fala no centro',
        steps: [
          'Leia uma frase curta em altura habitual.',
          'Repita com o centro 1 semitom acima. Depois 1 semitom abaixo.',
          'Observe onde o corpo trabalha mais.',
        ],
        durationSec: 30,
        cue: 'Procure o ponto em que falar parece "sem esforço".',
        pitfalls: ['Ir longe demais e perder naturalidade.'],
        targets: [
          t('f0MedianHz', '>=', 'Mudar de altura sem quebrar a voz', {
            semitones: 1,
            relative: 'baselineF0',
          }),
        ],
      },
    ],
  },
  {
    id: 'mapa-registro',
    moduleId: 'mapeamento',
    mode: 'shared',
    title: 'Transições de registro',
    objective: 'Encontrar onde sua voz troca de ajuste e passar por esse ponto sem quebra.',
    why: 'A quebra de registro é o momento em que a voz muda de coordenação. Suavizá-la permite ampliar a extensão útil sem esforço.',
    estimatedMinutes: 12,
    level: 3,
    exercises: [
      {
        id: 'mapa-reg-1',
        kind: 'glissando',
        title: 'Deslize através da quebra',
        steps: [
          'Escolha uma vogal fechada ("u" ou "i").',
          'Deslize lentamente, com volume baixo, passando pelo ponto onde a voz "vira".',
          'Ao chegar na quebra, reduza o volume em vez de empurrar.',
        ],
        durationSec: 30,
        cue: 'Na transição, menos ar e menos volume — não mais força.',
        pitfalls: [
          'Empurrar mais ar exatamente onde trava.',
          'Trocar de vogal para "fugir" da quebra.',
        ],
        targets: [
          t('registerBreaks', '<=', 'Reduzir quebras bruscas no deslize', { value: 2 }),
          t('voicedRatio', '>=', 'Manter som contínuo durante a transição', { value: 0.55 }),
        ],
      },
    ],
  },
];

const ressonanciaBase: Lesson[] = [
  {
    id: 'res-vogais',
    moduleId: 'ressonancia-base',
    mode: 'shared',
    title: 'Vogais moldam o timbre',
    objective: 'Perceber como cada vogal posiciona os formantes e muda a cor da voz.',
    why: 'F1 e F2 definem a identidade da vogal e boa parte do "lugar" da voz. Trabalhar vogais treina o trato vocal a produzir a cor desejada com menos esforço.',
    estimatedMinutes: 10,
    level: 2,
    exercises: [
      {
        id: 'res-vog-1',
        kind: 'sustentado',
        title: 'Sequência de vogais na mesma nota',
        steps: [
          'Sustente "i", depois "e", "a", "o", "u" — cada uma por 2 segundos, na mesma nota confortável.',
          'Mantenha a altura; só a boca muda.',
          'Observe no gráfico como F1 e F2 se movem.',
        ],
        durationSec: 30,
        cue: 'A altura fica parada; o trato vocal faz o trabalho.',
        pitfalls: ['Mudar a altura junto com a vogal.', 'Travar a mandíbula no "i".'],
        targets: [
          t('f0Stability', '>=', 'Altura estável entre vogais', { value: 60 }),
          t('formantF2Hz', '>=', 'F2 se move com as vogais', { value: 900 }),
        ],
      },
    ],
  },
  {
    id: 'res-claro-escuro',
    moduleId: 'ressonancia-base',
    mode: 'shared',
    title: 'Claro e escuro com controle',
    objective: 'Controlar o brilho do timbre de forma gradual e reversível.',
    why: 'Controle de brilho é o recurso mais flexível do treino: muda a percepção de timbre sem exigir altura nova e é o que permite ajustar a voz ao contexto.',
    estimatedMinutes: 12,
    level: 3,
    exercises: [
      {
        id: 'res-ce-1',
        kind: 'fala',
        title: 'Mesma frase em três cores',
        steps: [
          'Diga "Bom dia, tudo bem?" três vezes.',
          'Primeira: timbre escuro. Segunda: neutro. Terceira: claro e leve.',
          'Compare o índice de ressonância das três no relatório.',
        ],
        durationSec: 35,
        cue: 'A cor muda; o volume e a naturalidade não.',
        pitfalls: ['Escurecer apertando a garganta.', 'Clarear virando falsete.'],
        targets: [
          t('resonanceIndex', '>=', 'Alcançar brilho acima da sua linha de base', {
            value: 8,
            relative: 'baselineBrightness',
            weight: 1.2,
          }),
        ],
      },
    ],
  },
  {
    id: 'res-articulacao',
    moduleId: 'ressonancia-base',
    mode: 'shared',
    title: 'Articulação e inteligibilidade',
    objective: 'Falar com clareza no volume real, sem apertar.',
    why: 'Nitidez de consoantes muda muito a percepção da fala — às vezes mais que a altura. Articulação precisa é também proteção: menos esforço para ser entendido.',
    estimatedMinutes: 8,
    level: 2,
    exercises: [
      {
        id: 'res-art-1',
        kind: 'leitura',
        title: 'Frase trava-língua em volume de conversa',
        steps: [
          'Leia "seis sapos saltam sobre três pratos tristes" três vezes.',
          'Mantenha volume de conversa, sem sussurrar e sem gritar.',
          'Foque nas consoantes finais — sem comê-las.',
        ],
        durationSec: 25,
        cue: 'Clareza vem de precisão, não de força.',
        pitfalls: ['Sussurrar para "soar delicado" — isso esconde a voz, não articula.'],
        targets: [
          t('voicedRatio', '>=', 'Falar com voz apoiada, não sussurrada', {
            value: 0.35,
            weight: 1.5,
          }),
          t('levelStability', '>=', 'Volume regular entre as repetições', { value: 55 }),
        ],
      },
    ],
  },
];

const prosodia: Lesson[] = [
  {
    id: 'pros-melodia',
    moduleId: 'prosodia',
    mode: 'shared',
    title: 'Melodia da frase',
    objective: 'Ampliar a variação de altura na fala de forma natural.',
    why: 'A variação melódica (prosódia) carrega boa parte da expressividade e da percepção de gênero na fala. Ela pode ser treinada separadamente da altura média.',
    estimatedMinutes: 10,
    level: 3,
    exercises: [
      {
        id: 'pros-mel-1',
        kind: 'leitura',
        title: 'Mesma frase, três entonações',
        steps: [
          'Leia a frase como afirmação, depois como pergunta, depois com surpresa.',
          'Deixe a melodia trabalhar — não mude o volume.',
          'Observe a faixa de prosódia no relatório.',
        ],
        durationSec: 35,
        cue: 'Pergunta termina subindo; afirmação pode descer suave.',
        pitfalls: ['Subir tudo, virando um padrão único e artificial.'],
        targets: [t('prosodySt', '>=', 'Faixa melódica de pelo menos 5 semitons', { value: 5 })],
      },
      {
        id: 'pros-mel-2',
        kind: 'fala',
        title: 'Ênfase que muda o sentido',
        steps: [
          'Diga "eu não disse isso" enfatizando cada palavra, uma por vez.',
          'Note como a altura e a duração se reorganizam.',
          'Grave e compare as versões.',
        ],
        durationSec: 30,
        cue: 'Ênfase combina altura, duração e intensidade.',
        pitfalls: ['Enfatizar tudo, gerando monotonia de intensidade.'],
        targets: [t('prosodySt', '>=', 'Manter variação melódica', { value: 4 })],
      },
    ],
  },
  {
    id: 'pros-ritmo',
    moduleId: 'prosodia',
    mode: 'shared',
    title: 'Ritmo, pausas e finais de frase',
    objective: 'Sustentar a voz até o fim da frase, sem "comer" o final.',
    why: 'Finais de frase são onde a voz perde apoio e onde o ouvinte percebe insegurança. Sustentar o fim muda muito a impressão da fala.',
    estimatedMinutes: 8,
    level: 2,
    exercises: [
      {
        id: 'pros-rit-1',
        kind: 'leitura',
        title: 'Frase longa sem perder o fim',
        steps: [
          'Leia uma frase de 15 palavras numa respiração.',
          'Mantenha o volume das últimas palavras igual ao das primeiras.',
          'Repita com uma pausa curta no meio, se precisar.',
        ],
        durationSec: 30,
        cue: 'Distribua o ar: a última palavra merece o mesmo combustível.',
        pitfalls: ['Começar forte e terminar sem ar.', 'Acelerar no final.'],
        targets: [t('levelStability', '>=', 'Volume estável do início ao fim', { value: 55 })],
      },
    ],
  },
];

const avancado: Lesson[] = [
  {
    id: 'avc-dinamica',
    moduleId: 'avancado',
    mode: 'shared',
    title: 'Dinâmica sem perder o timbre',
    objective: 'Falar baixo e alto mantendo a mesma cor e o mesmo apoio.',
    why: 'Voz cotidiana alterna intensidade. Quem só treina num volume acaba perdendo o timbre ao sussurrar ou ao falar mais alto.',
    estimatedMinutes: 10,
    level: 4,
    exercises: [
      {
        id: 'avc-din-1',
        kind: 'leitura',
        title: 'Três volumes, mesma cor',
        steps: [
          'Leia a frase em volume baixo, médio e alto.',
          'Mantenha o índice de ressonância parecido nos três.',
          'No volume alto, não grite: projete.',
        ],
        durationSec: 40,
        cue: 'Projetar é mais ar e foco, não força de garganta.',
        pitfalls: ['Perder o brilho ao falar baixo.', 'Gritar ao falar alto.'],
        targets: [
          t('levelSd', '<=', 'Sem picos bruscos de volume', { value: 9 }),
          t('resonanceIndex', '>=', 'Preservar brilho no volume baixo', {
            value: 3,
            relative: 'baselineBrightness',
          }),
        ],
      },
    ],
  },
  {
    id: 'avc-real',
    moduleId: 'avancado',
    mode: 'shared',
    title: 'Voz no mundo real',
    objective: 'Transferir o treino para telefone, videochamada e conversa em ambiente ruidoso.',
    why: 'O que funciona na sala silenciosa costuma desmontar no telefone. Praticar com restrição de banda e ruído consolida o ajuste.',
    estimatedMinutes: 12,
    level: 5,
    exercises: [
      {
        id: 'avc-real-1',
        kind: 'livre',
        title: 'Simulação de telefonema',
        steps: [
          'Grave 20 segundos como se estivesse ao telefone.',
          'Ouça a gravação com fones, sem olhar os gráficos.',
          'Volte e compare métricas com a fala natural inicial.',
        ],
        durationSec: 25,
        cue: 'Telefone corta graves: o brilho carrega a identificação.',
        pitfalls: ['Aumentar volume para compensar — piora a distorção.'],
        targets: [t('f0Stability', '>=', 'Manter estabilidade em fala contínua', { value: 55 })],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Trilha MTF                                                          */
/* ------------------------------------------------------------------ */

const mtfBase: Lesson[] = [
  {
    id: 'mtf-peso',
    moduleId: 'mtf-base',
    mode: 'mtf',
    title: 'Peso vocal mais leve',
    objective: 'Reduzir o "peso" (contato das pregas) sem virar sussurro.',
    why: 'Peso e brilho mudam a impressão de timbre antes mesmo da altura. Reduzir peso com apoio mantém a voz audível e saudável.',
    estimatedMinutes: 12,
    level: 2,
    exercises: [
      {
        id: 'mtf-peso-1',
        kind: 'sustentado',
        title: 'Nota leve e apoiada',
        steps: [
          'Sustente "aaa" na sua nota confortável, com som leve (quase "humming" aberto).',
          'Mantenha o volume estável — leve não é fraco.',
          'Compare H1–H2 com a sua linha de base.',
        ],
        durationSec: 25,
        cue: 'Menos "encorpado", mesma presença.',
        pitfalls: ['Ir para sussurro e perder apoio.', 'Aumentar a soprosidade demais.'],
        targets: [
          t('hnrDb', '>=', 'Manter voz limpa (sem virar ar)', { value: 10 }),
          t('levelStability', '>=', 'Volume constante', { value: 60 }),
        ],
      },
      {
        id: 'mtf-peso-2',
        kind: 'fala',
        title: 'Frase leve no volume de sempre',
        steps: [
          'Leia a frase de treino com peso leve.',
          'Confira se o volume medido é parecido com sua fala natural.',
          'Se a voz "escapar" em ar, sustente mais a saída.',
        ],
        durationSec: 30,
        cue: 'Leve e audível ao mesmo tempo.',
        pitfalls: ['Falar baixo demais para esconder o peso.'],
        targets: [t('breathiness', '<=', 'Soprosidade controlada', { value: 0.5 })],
      },
    ],
  },
  {
    id: 'mtf-brilho',
    moduleId: 'mtf-base',
    mode: 'mtf',
    title: 'Brilho frontal',
    objective: 'Deslocar a sensação de ressonância para a frente do rosto.',
    why: 'A percepção de "voz feminina" costuma estar mais ligada à cor (energia em 2–4 kHz) do que à altura isolada.',
    estimatedMinutes: 12,
    level: 3,
    exercises: [
      {
        id: 'mtf-brilho-1',
        kind: 'sustentado',
        title: 'Vogais frontais com foco',
        steps: [
          'Sustente "i" e depois "e" sentindo vibração no nariz e maçãs do rosto.',
          'Mantenha a mesma nota nos dois.',
          'Observe a energia de presença no gráfico.',
        ],
        durationSec: 25,
        cue: 'Foco à frente, garganta livre.',
        pitfalls: ['Apertar o nariz e sair som nasalado.', 'Levantar a laringe à força.'],
        targets: [
          t('resonanceIndex', '>=', 'Aumentar brilho em relação à linha de base', {
            value: 10,
            relative: 'baselineBrightness',
            weight: 1.5,
          }),
          t('f0Stability', '>=', 'Sem escorregar de altura', { value: 55 }),
        ],
      },
    ],
  },
];

const mtfAlturas: Lesson[] = [
  {
    id: 'mtf-degraus',
    moduleId: 'mtf-alturas',
    mode: 'mtf',
    title: 'Degraus de meio tom',
    objective: 'Subir a altura em passos pequenos e controlados, sem quebra.',
    why: 'Subir 1 semitom por vez dá ao corpo tempo de reorganizar o ajuste. É mais seguro e mais sustentável que saltos grandes.',
    estimatedMinutes: 12,
    level: 3,
    exercises: [
      {
        id: 'mtf-deg-1',
        kind: 'escala',
        title: 'Escala de semitons',
        steps: [
          'Comece na sua nota confortável e suba um semitom a cada 2 segundos, até 4 acima.',
          'Volte descendo pelos mesmos degraus.',
          'Sem empurrar: se travar, pare um degrau antes.',
        ],
        durationSec: 30,
        cue: 'Meio tom por vez. Sempre.',
        pitfalls: ['Pular degraus quando o corpo cansa.'],
        targets: [
          t('f0MedianHz', '>=', 'Alcançar +2 st sobre a linha de base', {
            semitones: 2,
            relative: 'baselineF0',
            weight: 1.4,
          }),
        ],
      },
      {
        id: 'mtf-deg-2',
        kind: 'sustentado',
        title: 'Segurar a nota nova',
        steps: [
          'Sustente a nota 2 semitons acima da sua linha de base por 4 segundos.',
          'Repita 3 vezes, com pausa.',
          'Compare a estabilidade com a da nota confortável.',
        ],
        durationSec: 25,
        cue: 'Sustentar é diferente de alcançar.',
        pitfalls: ['Chegar na nota e escorregar para baixo.'],
        targets: [
          t('f0MedianHz', '>=', 'Nota sustentada acima da base', {
            semitones: 1.5,
            relative: 'baselineF0',
          }),
          t('f0Stability', '>=', 'Estabilidade na nota nova', { value: 55 }),
        ],
      },
    ],
  },
  {
    id: 'mtf-fala-altura',
    moduleId: 'mtf-alturas',
    mode: 'mtf',
    title: 'Fala em altura nova',
    objective: 'Falar frases inteiras com o centro alguns semitons acima, mantendo naturalidade.',
    why: 'Exercício isolado não muda a fala. É na frase que a altura nova começa a parecer sua.',
    estimatedMinutes: 14,
    level: 4,
    exercises: [
      {
        id: 'mtf-fala-1',
        kind: 'leitura',
        title: 'Leitura em altura elevada',
        steps: [
          'Leia a frase de treino com o centro 2 semitons acima da sua base.',
          'Mantenha o brilho frontal e o volume de conversa.',
          'Regrave até soar natural para você mesmo.',
        ],
        durationSec: 40,
        cue: 'Naturalidade é o critério final — não o número.',
        pitfalls: ['Falar num padrão único, "cantado".', 'Perder a melodia para segurar a nota.'],
        targets: [
          t('f0MedianHz', '>=', 'Centro de fala acima da base', {
            semitones: 1.5,
            relative: 'baselineF0',
            weight: 1.5,
          }),
          t('prosodySt', '>=', 'Manter melodia de fala', { value: 4 }),
        ],
      },
    ],
  },
];

const mtfIntegracao: Lesson[] = [
  {
    id: 'mtf-consistencia',
    moduleId: 'mtf-integracao',
    mode: 'mtf',
    title: 'Consistência ao longo do dia',
    objective: 'Manter o ajuste em frases longas e depois de cansaço.',
    why: 'A voz tende a "voltar" ao padrão antigo quando a atenção cai. Treinar sob cansaço leve é o que consolida o hábito.',
    estimatedMinutes: 12,
    level: 5,
    exercises: [
      {
        id: 'mtf-cons-1',
        kind: 'fala',
        title: 'Dois minutos de conversa',
        steps: [
          'Fale livremente por 60 segundos sobre qualquer assunto.',
          'Repita por mais 60 segundos mantendo o ajuste.',
          'Compare os dois trechos: altura e brilho caíram?',
        ],
        durationSec: 60,
        cue: 'Se começar a cair, recupere com apoio e brilho — não com força.',
        pitfalls: ['Ignorar a queda no segundo trecho.'],
        targets: [
          t('f0MedianHz', '>=', 'Manter o centro no segundo trecho', {
            semitones: 1,
            relative: 'baselineF0',
          }),
          t('resonanceIndex', '>=', 'Preservar brilho no final', {
            value: 3,
            relative: 'baselineBrightness',
          }),
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Trilha FTM                                                          */
/* ------------------------------------------------------------------ */

const ftmPeso: Lesson[] = [
  {
    id: 'ftm-peso',
    moduleId: 'ftm-peso',
    mode: 'ftm',
    title: 'Construir peso vocal',
    objective: 'Aumentar a sensação de corpo na voz sem apertar a garganta.',
    why: 'Percepção de voz grave depende mais de peso e ressonância baixa do que de descer muitos semitons. Peso bem construído protege a laringe.',
    estimatedMinutes: 12,
    level: 2,
    exercises: [
      {
        id: 'ftm-peso-1',
        kind: 'sustentado',
        title: 'Nota com peso e apoio',
        steps: [
          'Sustente "aaa" na nota confortável com mais corpo (mais contato, não mais força).',
          'Mantenha a garganta relaxada e o volume estável.',
          'Confira a relação harmônico-ruído: peso não é ruído.',
        ],
        durationSec: 25,
        cue: 'Corpo e limpeza juntos. Se raspar, é força demais.',
        pitfalls: ['Empurrar com a garganta (som "apertado").', 'Transformar peso em gritaria.'],
        targets: [
          t('hnrDb', '>=', 'Voz limpa com peso', { value: 12 }),
          t('levelStability', '>=', 'Volume constante', { value: 60 }),
        ],
      },
    ],
  },
  {
    id: 'ftm-ressonancia',
    moduleId: 'ftm-peso',
    mode: 'ftm',
    title: 'Ressonância de peito',
    objective: 'Escurecer o timbre com espaço, não com aperto.',
    why: 'Sensação de peito vem de trato vocal mais largo e sons com mais energia grave. Apertar a garganta produz o efeito oposto.',
    estimatedMinutes: 12,
    level: 3,
    exercises: [
      {
        id: 'ftm-res-1',
        kind: 'sustentado',
        title: 'Vogais abertas com espaço',
        steps: [
          'Sustente "a" e "ó" com a boca mais aberta e a garganta relaxada.',
          'Sinta a vibração no peito com a mão.',
          'Compare a inclinação espectral com sua base.',
        ],
        durationSec: 25,
        cue: 'Espaço gera grave. Aperto gera estrangulamento.',
        pitfalls: ['Abaixar a laringe à força e perder a naturalidade.'],
        targets: [
          t('tiltDbPerOct', '<=', 'Espectro mais grave (inclinação menor)', { value: -12 }),
        ],
      },
    ],
  },
];

const ftmAlturas: Lesson[] = [
  {
    id: 'ftm-descida',
    moduleId: 'ftm-alturas',
    mode: 'ftm',
    title: 'Descida controlada',
    objective: 'Descer a altura em degraus, mantendo o apoio e a clareza.',
    why: 'Descer demais de uma vez costuma produzir voz "engolida" e cansaço. Degraus permitem ganho sustentável.',
    estimatedMinutes: 12,
    level: 3,
    exercises: [
      {
        id: 'ftm-desc-1',
        kind: 'escala',
        title: 'Degraus descendentes',
        steps: [
          'Da nota confortável, desça um semitom a cada 2 segundos até 4 abaixo.',
          'Mantenha o volume e a articulação no grave.',
          'Se raspar, pare um degrau antes.',
        ],
        durationSec: 30,
        cue: 'Grave com clareza, não com aperto.',
        pitfalls: ['Descer até o vocal fry involuntário.'],
        targets: [
          t('f0MedianHz', '<=', 'Chegar a −2 st da linha de base', {
            semitones: -2,
            relative: 'baselineF0',
            weight: 1.4,
          }),
        ],
      },
    ],
  },
  {
    id: 'ftm-fala-baixa',
    moduleId: 'ftm-alturas',
    mode: 'ftm',
    title: 'Fala com centro mais baixo',
    objective: 'Levar o centro de fala um pouco abaixo, sem perder expressividade nem projeção.',
    why: 'Falar sempre no piso da voz soa artificial e cansa. O objetivo é um centro confortável, não o extremo.',
    estimatedMinutes: 14,
    level: 4,
    exercises: [
      {
        id: 'ftm-fala-1',
        kind: 'leitura',
        title: 'Leitura com centro reduzido',
        steps: [
          'Leia a frase 2 semitons abaixo da sua base habitual.',
          'Mantenha a melodia e as consoantes.',
          'Compare com a leitura natural no relatório.',
        ],
        durationSec: 40,
        cue: 'Mais grave, igualmente vivo.',
        pitfalls: ['Monotonizar para segurar a nota baixa.', 'Comer consoantes finais.'],
        targets: [
          t('f0MedianHz', '<=', 'Centro abaixo da linha de base', {
            semitones: -1.5,
            relative: 'baselineF0',
            weight: 1.4,
          }),
          t('prosodySt', '>=', 'Manter melodia', { value: 4 }),
        ],
      },
    ],
  },
];

const ftmIntegracao: Lesson[] = [
  {
    id: 'ftm-projecao',
    moduleId: 'ftm-integracao',
    mode: 'ftm',
    title: 'Projeção e consistência',
    objective: 'Manter o ajuste em volume alto e em ambiente ruidoso.',
    why: 'No dia a dia a voz precisa competir com ruído. Projetar sem gritar evita voltar ao padrão antigo e protege a laringe.',
    estimatedMinutes: 12,
    level: 5,
    exercises: [
      {
        id: 'ftm-proj-1',
        kind: 'fala',
        title: 'Fala projetada',
        steps: [
          'Fale uma frase em volume médio e depois projetado (como para alguém a 5 metros).',
          'Mantenha o peso e a clareza nos dois.',
          'Verifique clipping: se aparecer, reduza o ganho ou afaste-se do microfone.',
        ],
        durationSec: 35,
        cue: 'Projeção é fluxo de ar focado.',
        pitfalls: ['Gritar e distorcer o sinal.', 'Perder o grave ao projetar.'],
        targets: [
          t('clippingRatio', '<=', 'Sem clipping na captura', { value: 0.001, weight: 1.5 }),
          t('hnrDb', '>=', 'Manter limpeza ao projetar', { value: 10 }),
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Montagem                                                            */
/* ------------------------------------------------------------------ */

export const TRAINING_MODULES: TrainingModule[] = [
  {
    id: 'fundamentos',
    mode: 'shared',
    title: 'Fundamentos',
    subtitle: 'Ar, saúde e escuta',
    description:
      'A base que vale para qualquer voz e qualquer objetivo: fluxo de ar estável, aquecimento e a diferença entre altura, peso e brilho.',
    order: 1,
    accent: 'white',
    lessons: fundamentos,
  },
  {
    id: 'mapeamento',
    mode: 'shared',
    title: 'Mapa da sua voz',
    subtitle: 'Extensão, registros, conforto',
    description:
      'Conhecer piso, teto e centro confortável para que todas as metas sejam proporcionais a você.',
    order: 2,
    accent: 'blue',
    lessons: mapeamento,
  },
  {
    id: 'ressonancia-base',
    mode: 'shared',
    title: 'Ressonância e timbre',
    subtitle: 'Vogais, brilho, articulação',
    description:
      'Onde a maior parte da mudança perceptível acontece: cor do timbre, formantes e clareza.',
    order: 3,
    accent: 'pink',
    lessons: ressonanciaBase,
  },
  {
    id: 'prosodia',
    mode: 'shared',
    title: 'Prosódia e fala real',
    subtitle: 'Melodia, ritmo, finais',
    description: 'Levar o controle para frases inteiras, com naturalidade e expressividade.',
    order: 4,
    accent: 'mint',
    lessons: prosodia,
  },
  {
    id: 'mtf-base',
    mode: 'mtf',
    title: 'Feminização: base',
    subtitle: 'Peso leve e brilho frontal',
    description:
      'Os dois ajustes com maior impacto perceptivo na feminização vocal: menos peso e mais cor frontal.',
    order: 1,
    accent: 'pink',
    lessons: mtfBase,
  },
  {
    id: 'mtf-alturas',
    mode: 'mtf',
    title: 'Feminização: altura',
    subtitle: 'Degraus, sustentação, fala',
    description: 'Subir de forma gradual, sustentar a nota nova e levar isso para frases inteiras.',
    order: 2,
    accent: 'pink',
    lessons: mtfAlturas,
  },
  {
    id: 'mtf-integracao',
    mode: 'mtf',
    title: 'Feminização: integração',
    subtitle: 'Consistência e naturalidade',
    description: 'Manter o ajuste sob cansaço, em conversa longa e no mundo real.',
    order: 3,
    accent: 'blue',
    lessons: mtfIntegracao,
  },
  {
    id: 'ftm-peso',
    mode: 'ftm',
    title: 'Masculinização: base',
    subtitle: 'Peso e ressonância grave',
    description: 'Construir corpo na voz com segurança antes de mexer na altura.',
    order: 1,
    accent: 'blue',
    lessons: ftmPeso,
  },
  {
    id: 'ftm-alturas',
    mode: 'ftm',
    title: 'Masculinização: altura',
    subtitle: 'Descida controlada e fala',
    description: 'Descer em degraus, com clareza e expressividade preservadas.',
    order: 2,
    accent: 'blue',
    lessons: ftmAlturas,
  },
  {
    id: 'ftm-integracao',
    mode: 'ftm',
    title: 'Masculinização: integração',
    subtitle: 'Projeção e consistência',
    description: 'Sustentar o ajuste em volume alto e ambientes ruidosos.',
    order: 3,
    accent: 'mint',
    lessons: ftmIntegracao,
  },
  {
    id: 'avancado',
    mode: 'shared',
    title: 'Refinamento',
    subtitle: 'Dinâmica e mundo real',
    description:
      'Dinâmica, telefone, ruído e manutenção — para quando o básico já está automático.',
    order: 5,
    accent: 'mint',
    lessons: avancado,
  },
];

/** Todos os exercícios indexados por id, para busca rápida. */
export const EXERCISE_INDEX = new Map(
  TRAINING_MODULES.flatMap((m) =>
    m.lessons.flatMap((l) =>
      l.exercises.map((e) => [e.id, { lesson: l, module: m, exercise: e }] as const),
    ),
  ),
);

export const LESSON_INDEX = new Map(
  TRAINING_MODULES.flatMap((m) => m.lessons.map((l) => [l.id, { lesson: l, module: m }] as const)),
);

export function modulesForMode(mode: 'mtf' | 'ftm' | 'shared'): TrainingModule[] {
  if (mode === 'shared') return TRAINING_MODULES.filter((m) => m.mode === 'shared');
  return TRAINING_MODULES.filter((m) => m.mode === 'shared' || m.mode === mode);
}

export function lessonById(id: string): Lesson | null {
  return LESSON_INDEX.get(id)?.lesson ?? null;
}

/** Textos de leitura usados nos exercícios, sem gênero marcado. */
export const READING_PASSAGES: string[] = [
  'Hoje o céu está limpo e a cidade acorda devagar, com o barulho das janelas abrindo.',
  'Quem canta seus males espanta, diz o ditado, e talvez ele tenha mais razão do que parece.',
  'Precisamos comprar pão, café e algumas frutas antes que a feira feche.',
  'A voz muda todos os dias, e nenhuma mudança precisa acontecer de uma vez só.',
  'Quando a conversa fica longa, o corpo avisa: ombros sobem, a garganta aperta.',
];
