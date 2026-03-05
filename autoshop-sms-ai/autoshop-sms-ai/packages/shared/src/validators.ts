export function isE164(phone: string): boolean {
  return /^\+1[2-9]\d{9}$/.test(phone);
}

export function sanitizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone;
}

export function isCloseIntent(message: string): boolean {
  const lower = message.toLowerCase().trim();
  const triggers = ['stop', 'done', 'cancel', 'quit', 'bye', 'no thanks', 'never mind', 'nevermind'];
  return triggers.some(t => lower === t || lower.startsWith(t + ' '));
}
