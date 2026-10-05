export type AlertChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type AlertRecipient = { id: string; name: string; email: string; mobile: string; channels: AlertChannel[]; enabled: boolean; consent: boolean };
export const MAX_ALERT_RECIPIENTS: number;
export function validateAlertRecipients(value: unknown): AlertRecipient[];
