import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
export const HOSTINGER_EMAIL_ADDRESS: 'bookings@stor24.co.za';
export function hostingerTransport(env?: { HOSTINGER_SMTP_PASSWORD?: string }): Transporter<SMTPTransport.SentMessageInfo>;
