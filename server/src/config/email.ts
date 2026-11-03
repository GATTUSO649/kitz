import { db } from './database.js'
import { recordProviderMeasurement } from '../modules/operations/monitoring-recorder.js'
import { env } from './env.js'
import { emailDeliveryLogs } from '../database/schema.js'
import nodemailer from 'nodemailer'

export type EmailNotificationType = 'email_verification' | 'password_reset' | 'order_created' | 'order_paid' | 'order_update' | 'security_notice'

type EmailLogStatus = 'queued' | 'accepted' | 'delivered' | 'rejected' | 'failed'

export type EmailSendResult = {
  accepted: boolean
  status: 'accepted' | 'skipped' | 'failed'
  providerMessageId?: string
  reason?: string
}

export type SendTransactionalEmailOptions = {
  to: string
  subject: string
  text: string
  html: string
  notificationType: EmailNotificationType
  userId?: number
  orderId?: number
}

function getFromAddress() {
  return env.EMAIL_FROM || 'KitCulture <noreply@localhost>'
}

export function transactionalEmailConfigured() {
  if (env.EMAIL_PROVIDER === 'smtp') return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.EMAIL_FROM)
  if (env.EMAIL_PROVIDER === 'resend') return Boolean(env.EMAIL_FROM && env.RESEND_API_KEY)
  return false
}

export function buildAbsoluteUrl(path: string) {
  const base = env.APP_BASE_URL ?? env.APP_URL ?? 'http://localhost:5173'
  return new URL(path, `${base.replace(/\/$/, '')}/`).toString()
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderHtmlEmail(subject: string, bodyHtml: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827"><div style="max-width:640px;margin:0 auto;padding:32px 20px"><div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px"><h1 style="margin:0 0 16px;font-size:28px;color:#111827">${escapeHtml(subject)}</h1>${bodyHtml}</div></div></body></html>`
}

async function persistEmailLog(input: SendTransactionalEmailOptions, status: EmailLogStatus, providerMessageId?: string, errorCategory?: string, errorMessage?: string) {
  if (!db) return
  try {
    await db.insert(emailDeliveryLogs).values({
      userId: input.userId ?? null,
      orderId: input.orderId ?? null,
      notificationType: input.notificationType,
      recipientEmail: input.to,
      providerMessageId: providerMessageId ?? null,
      status,
      attempts: 1,
      lastAttemptAt: new Date(),
      errorCategory: errorCategory ?? null,
      errorMessage: errorMessage ?? null,
    })
  } catch {
    // The email log is optional; do not fail the request if the database is temporarily unavailable.
  }
}

export async function sendTransactionalEmail(input: SendTransactionalEmailOptions): Promise<EmailSendResult> {
  if (env.EMAIL_PROVIDER === 'smtp') {
    if (!env.SMTP_HOST || !env.SMTP_PORT || !env.EMAIL_FROM) {
      await persistEmailLog(input, 'failed', undefined, 'configuration_error', 'SMTP delivery is not configured.')
      return { accepted: false, status: 'failed', reason: 'EMAIL_PROVIDER_NOT_CONFIGURED' }
    }
    const startedAt = Date.now()
    try {
      const secure = env.SMTP_SECURE ?? false
      const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure,
        requireTLS: env.SMTP_REQUIRE_TLS ?? (!secure && env.SMTP_PORT === 2525 ? true : undefined),
        auth: env.SMTP_USER || env.SMTP_PASS ? { user: env.SMTP_USER ?? '', pass: env.SMTP_PASS ?? '' } : undefined,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 15_000,
      })
      const result = await transport.sendMail({ from: getFromAddress(), to: input.to, subject: input.subject, text: input.text, html: input.html })
      recordProviderMeasurement({ provider: 'smtp', operation: 'email_submit', durationMs: Date.now() - startedAt, outcome: result.accepted.length ? 'accepted_by_provider' : 'rejected' })
      await persistEmailLog(input, result.accepted.length ? 'accepted' : 'failed', result.messageId)
      return result.accepted.length ? { accepted: true, status: 'accepted', providerMessageId: result.messageId } : { accepted: false, status: 'failed', reason: 'SMTP_RECIPIENT_REJECTED' }
    } catch (error) {
      recordProviderMeasurement({ provider: 'smtp', operation: 'email_submit', durationMs: Date.now() - startedAt, outcome: 'network_error' })
      const smtpError = error as { code?: string; responseCode?: number }
      const reason = smtpError.code === 'EAUTH' || smtpError.responseCode === 535
        ? 'SMTP_AUTH_FAILED'
        : smtpError.responseCode === 550 || smtpError.code === 'EENVELOPE'
          ? 'SMTP_RECIPIENT_REJECTED'
          : smtpError.code === 'ETIMEDOUT' || smtpError.code === 'ECONNECTION' || smtpError.code === 'ENOTFOUND'
            ? 'SMTP_CONNECTION_FAILED'
            : 'SMTP_DELIVERY_FAILED'
      await persistEmailLog(input, 'failed', undefined, 'smtp_error', error instanceof Error ? error.name : 'SMTP delivery failed.')
      return { accepted: false, status: 'failed', reason }
    }
  }

  if (env.EMAIL_PROVIDER === 'disabled' || !env.EMAIL_FROM || !env.RESEND_API_KEY) {
    await persistEmailLog(input, 'queued')
    return { accepted: false, status: 'skipped', reason: 'EMAIL_PROVIDER_DISABLED' }
  }

  const payload = {
    from: getFromAddress(),
    to: [input.to],
    subject: input.subject,
    text: input.text,
    html: input.html,
    reply_to: env.EMAIL_REPLY_TO || undefined,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  const startedAt = Date.now()
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    recordProviderMeasurement({ provider: 'resend', operation: 'email_submit', durationMs: Date.now() - startedAt, outcome: response.ok ? 'accepted_by_provider' : 'rejected', httpStatus: response.status })
    const data = await response.json().catch(() => ({})) as { id?: string; message?: string }
    if (!response.ok) {
      const reason = data.message ?? `Provider rejected the email request (${response.status}).`
      await persistEmailLog(input, 'failed', undefined, 'provider_error', reason)
      return { accepted: false, status: 'failed', reason }
    }
    await persistEmailLog(input, 'accepted', data.id)
    return { accepted: true, status: 'accepted', providerMessageId: data.id }
  } catch (error) {
    recordProviderMeasurement({ provider: 'resend', operation: 'email_submit', durationMs: Date.now() - startedAt, outcome: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error' })
    const message = error instanceof Error ? error.message : 'Email delivery could not be completed.'
    await persistEmailLog(input, 'failed', undefined, 'network_error', message)
    return { accepted: false, status: 'failed', reason: message }
  } finally {
    clearTimeout(timeout)
  }
}

export function customerEmailTemplate({
  title,
  intro,
  actionLabel,
  actionUrl,
  footer,
}: {
  title: string
  intro: string
  actionLabel: string
  actionUrl: string
  footer: string
}) {
  const safeIntro = escapeHtml(intro).replace(/\n/g, '<br>')
  const safeFooter = escapeHtml(footer).replace(/\n/g, '<br>')
  const safeActionLabel = escapeHtml(actionLabel)
  return renderHtmlEmail(title, `
    <p style="font-size:16px;line-height:1.6;margin:0 0 16px;color:#374151">${safeIntro}</p>
    <div style="text-align:center;margin:28px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700">${safeActionLabel}</a></div>
    <p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0">${safeFooter}</p>
  `)
}
