const nodemailer = require('nodemailer');

let cachedSmtpTransport = null;

const getEmailProvider = () => String(process.env.EMAIL_PROVIDER || 'none').trim().toLowerCase();
const getEmailFrom = () => String(process.env.EMAIL_FROM || '').trim();

const isEmailEnabled = () => {
  const provider = getEmailProvider();
  if (provider === 'none' || provider === 'disabled' || provider === 'false') return false;
  return !!getEmailFrom();
};

const getSmtpTransport = () => {
  if (cachedSmtpTransport) return cachedSmtpTransport;

  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const secure = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true';

  if (!host || !port) throw new Error('SMTP is not configured (missing SMTP_HOST/SMTP_PORT)');

  cachedSmtpTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  return cachedSmtpTransport;
};

async function sendEmail({ to, subject, text, html }) {
  if (!isEmailEnabled()) return { ok: false, skipped: true };

  const provider = getEmailProvider();
  const from = getEmailFrom();
  const safeTo = Array.isArray(to) ? to : [to];

  if (!safeTo.filter(Boolean).length) throw new Error('Missing email recipient');
  if (!subject) throw new Error('Missing email subject');

  if (provider === 'sendgrid') {
    const apiKey = String(process.env.SENDGRID_API_KEY || '').trim();
    if (!apiKey) throw new Error('SENDGRID_API_KEY is not set');

    // Lazy require so local dev without dependency can still run when EMAIL_PROVIDER=none.
    // eslint-disable-next-line global-require
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(apiKey);

    await sgMail.send({
      to: safeTo,
      from,
      subject,
      text: text || undefined,
      html: html || undefined,
    });

    return { ok: true, provider: 'sendgrid' };
  }

  if (provider === 'smtp') {
    const transport = getSmtpTransport();
    await transport.sendMail({
      from,
      to: safeTo.join(', '),
      subject,
      text: text || undefined,
      html: html || undefined,
    });
    return { ok: true, provider: 'smtp' };
  }

  return { ok: false, skipped: true };
}

module.exports = {
  sendEmail,
  isEmailEnabled,
};
