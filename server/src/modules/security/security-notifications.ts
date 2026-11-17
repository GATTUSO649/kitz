import { env } from '../../config/env.js'
import { renderHtmlEmail, sendTransactionalEmail, transactionalEmailConfigured } from '../../config/email.js'

export type SecurityAlertNotification = {
  ruleId: string
  ruleName: string
  severity: string
  affectedService: string
  occurrenceCount: number
  windowSeconds: number
}

export function securityNotificationStatus() {
  return {
    configured: Boolean(env.ADMIN_NOTIFICATION_EMAIL && transactionalEmailConfigured()),
    recipientConfigured: Boolean(env.ADMIN_NOTIFICATION_EMAIL),
    providerConfigured: transactionalEmailConfigured(),
  }
}

export function buildSecurityAlertEmail(alert: SecurityAlertNotification) {
  const subject = `[KitCulture security] ${alert.severity.toUpperCase()} alert: ${alert.ruleName}`.slice(0, 180)
  const text = [
    'A security monitoring rule generated an alert.',
    `Severity: ${alert.severity}`,
    `Rule: ${alert.ruleName}`,
    `Application: ${alert.affectedService}`,
    `Matching events: ${alert.occurrenceCount} in ${alert.windowSeconds} seconds.`,
    'Review the authenticated Operations console. This signal is not proof of compromise.',
  ].join('\n')
  const html = renderHtmlEmail(subject, [
    '<p>A security monitoring rule generated an alert.</p>',
    `<p><strong>Severity:</strong> ${escapeHtml(alert.severity)}<br><strong>Rule:</strong> ${escapeHtml(alert.ruleName)}<br><strong>Application:</strong> ${escapeHtml(alert.affectedService)}<br><strong>Matching events:</strong> ${Math.max(0, alert.occurrenceCount)} in ${Math.max(0, alert.windowSeconds)} seconds.</p>`,
    '<p>Review the authenticated Operations console. This signal is not proof of compromise.</p>',
  ].join(''))
  return { subject, text, html }
}

export async function dispatchSecurityAlertEmail(alert: SecurityAlertNotification) {
  const recipient = env.ADMIN_NOTIFICATION_EMAIL
  if (!recipient || !transactionalEmailConfigured()) return { accepted: false, status: 'skipped' as const, reason: 'SECURITY_EMAIL_NOT_CONFIGURED' }
  const message = buildSecurityAlertEmail(alert)
  return sendTransactionalEmail({
    to: recipient,
    ...message,
    notificationType: 'security_notice',
  })
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}