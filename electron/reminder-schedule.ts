/**
 * Regra de disparo dos lembretes (função pura, sem Electron).
 *
 * Antes: um `setInterval` de 30 s comparava `HH:MM` atual com o horário
 * configurado. Se o computador estivesse suspenso ou o tick passasse daquele
 * minuto (timer atrasado por carga de CPU), o lembrete do dia era perdido em
 * silêncio. Agora a decisão é por janela de tolerância: dispara se agora está
 * depois do horário e a menos de `graceMinutes` dele, uma vez por dia.
 */

export interface ReminderSchedule {
  enabled: boolean;
  /** "HH:MM" em hora local. */
  time: string;
  /** 0 = domingo … 6 = sábado. Vazio significa todos os dias. */
  weekdays: number[];
}

export const DEFAULT_GRACE_MINUTES = 30;

export function parseReminderTime(time: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export interface ReminderDecision {
  fire: boolean;
  /** Chave de deduplicação (dia + horário) quando `fire` é true. */
  key: string;
  /** Minutos de atraso em relação ao horário previsto (0 = no horário). */
  lateMinutes: number;
}

/**
 * Decide se o lembrete deve disparar neste instante.
 *
 * `lastFiredKey` evita repetição (o processo pode ficar horas no mesmo minuto de
 * tolerância). Uma decisão "atrasada" ainda dispara, porque no uso real chegar
 * 5 minutos depois é melhor que não lembrar.
 */
export function shouldFireReminder(
  schedule: ReminderSchedule,
  now: Date,
  lastFiredKey: string,
  graceMinutes = DEFAULT_GRACE_MINUTES,
): ReminderDecision {
  const none: ReminderDecision = { fire: false, key: '', lateMinutes: 0 };
  if (!schedule.enabled) return none;
  if (schedule.weekdays.length > 0 && !schedule.weekdays.includes(now.getDay())) return none;

  const parsed = parseReminderTime(schedule.time);
  if (!parsed) return none;

  const scheduled = new Date(now);
  scheduled.setHours(parsed.hour, parsed.minute, 0, 0);

  const lateMs = now.getTime() - scheduled.getTime();
  if (lateMs < 0) return none; // ainda não chegou a hora
  const lateMinutes = Math.floor(lateMs / 60_000);
  if (lateMinutes > graceMinutes) return none; // janela passou (app ficou dias parado)

  const day = `${scheduled.getFullYear()}-${String(scheduled.getMonth() + 1).padStart(2, '0')}-${String(
    scheduled.getDate(),
  ).padStart(2, '0')}`;
  const key = `${day} ${schedule.time}`;
  if (key === lastFiredKey) return none;

  return { fire: true, key, lateMinutes };
}
