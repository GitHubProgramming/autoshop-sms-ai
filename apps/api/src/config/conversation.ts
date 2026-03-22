const DEFAULT_MAX_TURNS = 50;

export function getMaxConversationTurns(): number {
  const raw = process.env.MAX_CONVERSATION_TURNS;
  if (!raw) return DEFAULT_MAX_TURNS;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed <= 0) return DEFAULT_MAX_TURNS;
  return parsed;
}
