import nodemailer from 'nodemailer';

export const HOSTINGER_EMAIL_ADDRESS = 'bookings@stor24.co.za';

export function hostingerTransport(env = process.env) {
  if (!env.HOSTINGER_SMTP_PASSWORD) throw new Error('Hostinger SMTP credential is not configured.');
  return nodemailer.createTransport({
    host: 'smtp.hostinger.com', port: 465, secure: true,
    auth: { user: HOSTINGER_EMAIL_ADDRESS, pass: env.HOSTINGER_SMTP_PASSWORD },
    tls: { servername: 'smtp.hostinger.com', minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    dnsTimeout: 8_000, pool: false, logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
  });
}
