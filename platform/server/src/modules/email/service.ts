import nodemailer from 'nodemailer'

export type MarketplaceEmailKind =
  | 'product_submission_received'
  | 'publication_payment_initiated'
  | 'publication_payment_success'
  | 'product_published'
  | 'product_publication_failed'
  | 'product_removed'
  | 'contact_unlock_payment_initiated'
  | 'contact_unlock_payment_success'
  | 'contact_details_unlocked'
  | 'payment_unsuccessful'
  | 'payment_receipt'
  | 'admin_new_submission'
  | 'admin_publication_success'
  | 'admin_payment_failure'
  | 'admin_product_report'
  | 'admin_marketplace_activity'
  | 'seller_account_verification'
  | 'marketplace_admin_invitation'
  | 'marketplace_admin_verification'

export type MarketplaceEmailInput = {
  to: string
  kind: MarketplaceEmailKind
  data: Record<string, string | number | null | undefined>
}

export type MarketplaceEmailDelivery =
  | { status: 'sent'; providerMessageId?: string }
  | { status: 'retry'; code: string }
  | { status: 'failed'; code: string }
  | { status: 'uncertain'; code: string }

type MailMessage = { from: { name: string; address: string }; to: string; subject: string; text: string; html: string; replyTo?: string }
type SmtpOptions = { host: string; port: number; user: string; pass: string; secure: boolean; requireTLS: boolean }
type Dependencies = {
  env?: NodeJS.ProcessEnv
  sendSmtp?: (options: SmtpOptions, message: MailMessage) => Promise<{ accepted: string[]; messageId?: string }>
}

const eventCopy: Record<MarketplaceEmailKind, { subject: string; intro: string }> = {
  product_submission_received: { subject: 'We received your MarketHub listing', intro: 'Your listing has been received and is waiting for publication payment.' },
  publication_payment_initiated: { subject: 'MarketHub publication payment started', intro: 'An M-Pesa publication prompt was requested. Your listing remains unpublished until payment is verified.' },
  publication_payment_success: { subject: 'MarketHub payment confirmed', intro: 'Your publication payment was verified successfully.' },
  product_published: { subject: 'Your MarketHub listing is live', intro: 'Your listing has been published and is available to buyers.' },
  product_publication_failed: { subject: 'MarketHub publication payment was not completed', intro: 'The payment was not verified. Your listing remains unpublished.' },
  product_removed: { subject: 'An update about your MarketHub listing', intro: 'An administrator has removed your listing from the marketplace.' },
  contact_unlock_payment_initiated: { subject: 'MarketHub contact payment started', intro: 'An M-Pesa contact-unlock prompt was requested. Seller contact remains protected until payment is verified.' },
  contact_unlock_payment_success: { subject: 'MarketHub contact payment confirmed', intro: 'Your contact-unlock payment was verified successfully.' },
  contact_details_unlocked: { subject: 'MarketHub seller contact unlocked', intro: 'Your verified payment unlocked seller contact for the listing below.' },
  payment_unsuccessful: { subject: 'MarketHub payment was not completed', intro: 'The payment was not verified. No paid marketplace action was completed.' },
  payment_receipt: { subject: 'Your MarketHub payment receipt', intro: 'This is confirmation of a marketplace payment verified by M-Pesa.' },
  admin_new_submission: { subject: 'MarketHub: new listing submission', intro: 'A new listing is awaiting publication payment.' },
  admin_publication_success: { subject: 'MarketHub: listing published', intro: 'A publication payment was verified and the listing was published.' },
  admin_payment_failure: { subject: 'MarketHub: payment not completed', intro: 'A marketplace payment did not complete successfully.' },
  admin_product_report: { subject: 'MarketHub: listing report received', intro: 'A buyer submitted a report for a marketplace listing.' },
  admin_marketplace_activity: { subject: 'MarketHub marketplace activity alert', intro: 'An important marketplace event requires attention.' },
  seller_account_verification: { subject: 'Verify your MarketHub seller account', intro: 'Confirm your email address to activate your seller account.' },
  marketplace_admin_invitation: { subject: 'MarketHub second-hand admin invitation', intro: 'A marketplace Super Admin invited you to manage second-hand listings.' },
  marketplace_admin_verification: { subject: 'Verify your MarketHub administrator account', intro: 'Your password is set. Confirm your email address to activate Second-hand admin access.' },
}

function safeValue(value: unknown, maximum = 240): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const withoutControls = Array.from(String(value), (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('')
  return withoutControls.replace(/\s+/g, ' ').trim().slice(0, maximum)
}

export function escapeMarketplaceHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function renderMarketplaceEmail(input: MarketplaceEmailInput): { subject: string; text: string; html: string } {
  const copy = eventCopy[input.kind]
  const name = safeValue(input.data.name, 120)
  const title = safeValue(input.data.title, 160)
  const reference = safeValue(input.data.reference, 40)
  const amount = safeValue(input.data.amountKes, 20)
  const reason = safeValue(input.data.reason, 240)
  const actionUrl = safeValue(input.data.actionUrl, 2048)
  let safeActionUrl = ''
  try {
    const url = new URL(actionUrl)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) safeActionUrl = url.toString()
  } catch { /* An absent or invalid action URL is omitted. */ }
  const actionLabel = input.kind === 'marketplace_admin_invitation' ? 'Complete administrator onboarding' : 'Verify email address'
  const details = [
    ...(name ? [`Hello ${name},`] : []),
    copy.intro,
    ...(title ? [`Listing: ${title}`] : []),
    ...(reference ? [`Reference: ${reference}`] : []),
    ...(amount ? [`Amount: KSh ${amount}`] : []),
    ...(reason ? [`Details: ${reason}`] : []),
    ...(safeActionUrl ? [`Continue: ${safeActionUrl}`] : []),
  ]
  const htmlDetails = details.map((line) => `<p style="margin:0 0 14px;line-height:1.6;color:#25332d">${escapeMarketplaceHtml(line)}</p>`).join('')
  const actionLink = safeActionUrl ? `<p style="margin:24px 0"><a href="${escapeMarketplaceHtml(safeActionUrl)}" style="display:inline-block;padding:12px 18px;background:#078e3b;color:#fff;text-decoration:none;font-weight:700">${actionLabel}</a></p>` : ''
  return {
    subject: copy.subject,
    text: `${details.join('\n\n')}\n\nMarketHub Kenya`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeMarketplaceHtml(copy.subject)}</title></head><body style="margin:0;background:#f2f5f0;color:#25332d;font-family:Arial,Helvetica,sans-serif"><main style="max-width:600px;margin:32px auto;padding:32px;background:#fff;border:1px solid #dce5dc"><p style="margin:0 0 24px;color:#1c6b45;font-weight:700">MarketHub Kenya</p>${htmlDetails}${actionLink}<p style="margin:28px 0 0;color:#65736a;font-size:13px">This is an automated marketplace notification. Do not reply with payment credentials or one-time codes.</p></main></body></html>`,
  }
}

function brevoConfig(env: NodeJS.ProcessEnv): { smtp: SmtpOptions; from: { name: string; address: string } } | null {
  const port = Number(env.MARKETPLACE_BREVO_SMTP_PORT)
  const address = env.MARKETPLACE_BREVO_FROM_EMAIL?.trim()
  const name = safeValue(env.MARKETPLACE_BREVO_FROM_NAME || 'MarketHub', 120)
  const secure = env.MARKETPLACE_BREVO_SMTP_SECURE === 'true'
  if (!env.MARKETPLACE_BREVO_SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65_535
    || !env.MARKETPLACE_BREVO_SMTP_USER || !env.MARKETPLACE_BREVO_SMTP_PASSWORD || !address || !validRecipient(address)) return null
  return {
    smtp: {
      host: env.MARKETPLACE_BREVO_SMTP_HOST,
      port,
      user: env.MARKETPLACE_BREVO_SMTP_USER,
      pass: env.MARKETPLACE_BREVO_SMTP_PASSWORD,
      secure,
      requireTLS: env.MARKETPLACE_BREVO_SMTP_REQUIRE_TLS === 'true' || (!secure && (port === 2525 || port === 587)),
    },
    from: { name, address },
  }
}

function smtpFailure(error: unknown): MarketplaceEmailDelivery {
  const failure = error && typeof error === 'object' ? error as { code?: unknown; responseCode?: unknown } : {}
  if (typeof failure.responseCode === 'number' && failure.responseCode >= 400 && failure.responseCode < 500) return { status: 'retry', code: 'SMTP_TEMPORARY_REJECTION' }
  if (failure.code === 'EAUTH' || failure.code === 'EENVELOPE' || (typeof failure.responseCode === 'number' && failure.responseCode >= 500)) return { status: 'failed', code: 'SMTP_PERMANENT_REJECTION' }
  return { status: 'uncertain', code: 'SMTP_OUTCOME_UNKNOWN' }
}

function validRecipient(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)
}

export async function sendMarketplaceEmail(input: MarketplaceEmailInput, dependencies: Dependencies = {}): Promise<MarketplaceEmailDelivery> {
  const env = dependencies.env ?? process.env
  if (!validRecipient(input.to)) return { status: 'failed', code: 'INVALID_RECIPIENT' }
  const rendered = renderMarketplaceEmail(input)
  const provider = env.MARKETPLACE_EMAIL_PROVIDER ?? 'disabled'
  if (provider === 'smtp') {
    const config = brevoConfig(env)
    if (!config) return { status: 'failed', code: 'BREVO_SMTP_NOT_CONFIGURED' }
    const message: MailMessage = { from: config.from, to: input.to, ...rendered, ...(env.MARKETPLACE_EMAIL_REPLY_TO ? { replyTo: env.MARKETPLACE_EMAIL_REPLY_TO } : {}) }
    try {
      const result = dependencies.sendSmtp
        ? await dependencies.sendSmtp(config.smtp, message)
        : await nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          requireTLS: config.smtp.requireTLS,
          auth: { user: config.smtp.user, pass: config.smtp.pass },
          connectionTimeout: 15_000,
          greetingTimeout: 15_000,
          socketTimeout: 15_000,
        }).sendMail(message)
      return result.accepted.length ? { status: 'sent', providerMessageId: result.messageId } : { status: 'failed', code: 'SMTP_RECIPIENT_REJECTED' }
    } catch (error) {
      return smtpFailure(error)
    }
  }

  return { status: 'failed', code: provider === 'disabled' ? 'EMAIL_PROVIDER_DISABLED' : 'EMAIL_PROVIDER_UNSUPPORTED' }
}