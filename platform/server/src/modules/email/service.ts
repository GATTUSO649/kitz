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
  | 'seller_password_reset'
  | 'seller_password_reset_completed'
  | 'marketplace_admin_invitation'
  | 'marketplace_admin_verification'
  | 'admin_custom_message'

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
type ResendResult = { status: number; id?: string }
type Dependencies = {
  env?: NodeJS.ProcessEnv
  sendSmtp?: (options: SmtpOptions, message: MailMessage) => Promise<{ accepted: string[]; messageId?: string }>
  sendResend?: (apiKey: string, message: MailMessage) => Promise<ResendResult>
}

const eventCopy: Record<MarketplaceEmailKind, { subject: string; intro: string }> = {
  product_submission_received: { subject: 'We received your MarketHub listing', intro: 'Your listing has been received and is waiting for publication payment.' },
  publication_payment_initiated: { subject: 'MarketHub publication payment started', intro: 'An M-Pesa publication prompt was requested. Your listing remains unpublished until payment is verified.' },
  publication_payment_success: { subject: 'MarketHub payment confirmed', intro: 'Your publication payment was verified successfully.' },
  product_published: { subject: 'Your MarketHub listing is live', intro: 'Your listing has been published and is available to buyers.' },
  product_publication_failed: { subject: 'MarketHub publication payment was not completed', intro: 'The payment was not verified. Your listing remains unpublished.' },
  product_removed: { subject: 'An update about your MarketHub listing', intro: 'An administrator has removed your listing from the marketplace.' },
  contact_unlock_payment_initiated: { subject: 'MarketHub contact payment started', intro: 'An M-Pesa contact-unlock prompt was requested. Seller contact remains protected until payment is verified.' },
  contact_unlock_payment_success: { subject: 'MarketHub | Contact access payment confirmed', intro: 'Your payment has been verified and the seller contact details are available below.' },
  contact_details_unlocked: { subject: 'MarketHub seller contact unlocked', intro: 'Your verified payment unlocked seller contact for the listing below.' },
  payment_unsuccessful: { subject: 'MarketHub payment was not completed', intro: 'The payment was not verified. No paid marketplace action was completed.' },
  payment_receipt: { subject: 'Your MarketHub payment receipt', intro: 'This is confirmation of a marketplace payment verified by M-Pesa.' },
  admin_new_submission: { subject: 'MarketHub: new listing submission', intro: 'A new listing is awaiting publication payment.' },
  admin_publication_success: { subject: 'MarketHub: listing published', intro: 'A publication payment was verified and the listing was published.' },
  admin_payment_failure: { subject: 'MarketHub: payment not completed', intro: 'A marketplace payment did not complete successfully.' },
  admin_product_report: { subject: 'MarketHub: listing report received', intro: 'A buyer submitted a report for a marketplace listing.' },
  admin_marketplace_activity: { subject: 'MarketHub marketplace activity alert', intro: 'An important marketplace event requires attention.' },
  seller_account_verification: { subject: 'Verify your MarketHub seller account', intro: 'Confirm your email address to activate your seller account.' },
  seller_password_reset: { subject: 'Reset your MarketHub seller password', intro: 'Use this one-time link to choose a new password. It expires in one hour.' },
  seller_password_reset_completed: { subject: 'Your MarketHub seller password was changed', intro: 'Your seller account password was changed. All existing seller sessions have been signed out.' },
  marketplace_admin_invitation: { subject: 'MarketHub second-hand admin invitation', intro: 'A marketplace Super Admin invited you to manage second-hand listings.' },
  marketplace_admin_verification: { subject: 'Verify your MarketHub administrator account', intro: 'Your password is set. Confirm your email address to activate Second-hand admin access.' },
  admin_custom_message: { subject: 'A message from MarketHub', intro: '' },
}

function safeValue(value: unknown, maximum = 240): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const withoutControls = Array.from(String(value), (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('')
  return withoutControls.replace(/\s+/g, ' ').trim().slice(0, maximum)
}

export function escapeMarketplaceHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function renderContactUnlockConfirmation(input: MarketplaceEmailInput): { subject: string; text: string; html: string } {
  const payerName = safeValue(input.data.payerName, 120) || 'Customer'
  const listingTitle = safeValue(input.data.title, 160) || 'Marketplace listing'
  const reference = safeValue(input.data.reference, 40)
  const amount = safeValue(input.data.amountKes, 20)
  const sellerName = safeValue(input.data.sellerName, 120)
  const sellerPhone = safeValue(input.data.sellerPhone, 24)
  const sellerPhoneHref = sellerPhone.replace(/[^\d+]/g, '')
  const sellerWhatsApp = safeValue(input.data.sellerWhatsApp, 24).replace(/\D/g, '')
  const sellerEmail = safeValue(input.data.sellerEmail, 254)
  const sellerEmailHref = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sellerEmail) ? sellerEmail : ''
  const sellerLocation = safeValue(input.data.sellerLocation, 240)
  const sellerRows: { label: string; value: string; destination?: string }[] = []
  if (sellerName) sellerRows.push({ label: 'Seller', value: sellerName })
  if (sellerPhone) sellerRows.push({ label: 'Phone', value: sellerPhone, destination: `tel:${sellerPhoneHref}` })
  if (sellerWhatsApp) sellerRows.push({ label: 'WhatsApp', value: 'Message seller', destination: `https://wa.me/${sellerWhatsApp}` })
  if (sellerEmailHref) sellerRows.push({ label: 'Email', value: sellerEmailHref, destination: `mailto:${sellerEmailHref}` })
  if (sellerLocation) sellerRows.push({ label: 'Location', value: sellerLocation })
  const sellerHtml = sellerRows.map(({ label, value, destination }) => {
    const content = destination
      ? `<a href="${escapeMarketplaceHtml(destination)}" style="color:#17643e;text-decoration:underline">${escapeMarketplaceHtml(value)}</a>`
      : escapeMarketplaceHtml(value)
    return `<tr><th align="left" style="padding:8px 12px;color:#68756f;font-size:13px;font-weight:600">${escapeMarketplaceHtml(label)}</th><td style="padding:8px 12px;color:#1d2b24;font-size:13px">${content}</td></tr>`
  }).join('')
  const text = [
    `Hello ${payerName},`,
    eventCopy.contact_unlock_payment_success.intro,
    `Listing: ${listingTitle}`,
    ...(reference ? [`Payment reference: ${reference}`] : []),
    ...(amount ? [`Amount paid: KSh ${amount}`] : []),
    'Seller contact details:',
    ...(sellerName ? [`Name: ${sellerName}`] : []),
    ...(sellerPhone ? [`Phone: ${sellerPhone}`] : []),
    ...(sellerWhatsApp ? [`WhatsApp: https://wa.me/${sellerWhatsApp}`] : []),
    ...(sellerEmailHref ? [`Email: ${sellerEmailHref}`] : []),
    ...(sellerLocation ? [`Location: ${sellerLocation}`] : []),
    '',
    'MarketHub Kenya | This message confirms a verified M-PESA transaction. Never share your M-PESA PIN or one-time codes.',
  ].join('\n\n')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeMarketplaceHtml(eventCopy.contact_unlock_payment_success.subject)}</title></head><body style="margin:0;padding:24px 12px;background:#f1f4f2;color:#1d2b24;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;border-collapse:collapse;background:#fff;border:1px solid #dce5df"><tr><td style="padding:22px 28px;background:#123d2b;color:#fff"><div style="font-size:17px;font-weight:700;letter-spacing:.4px">MarketHub Kenya</div><div style="margin-top:5px;color:#d9e8df;font-size:11px;text-transform:uppercase">Verified payment confirmation</div></td></tr><tr><td style="padding:28px"><p style="margin:0 0 8px;color:#53645a;font-size:14px">Hello ${escapeMarketplaceHtml(payerName)},</p><h1 style="margin:0 0 12px;color:#173b29;font-size:22px;line-height:1.3">Contact access confirmed</h1><p style="margin:0 0 22px;color:#53645a;font-size:14px;line-height:1.65">${escapeMarketplaceHtml(eventCopy.contact_unlock_payment_success.intro)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e0e7e2;background:#f8faf8"><tr><th align="left" style="padding:10px 12px;color:#68756f;font-size:13px;font-weight:600">Listing</th><td style="padding:10px 12px;color:#1d2b24;font-size:13px">${escapeMarketplaceHtml(listingTitle)}</td></tr>${reference ? `<tr><th align="left" style="padding:8px 12px;color:#68756f;font-size:13px;font-weight:600">Payment reference</th><td style="padding:8px 12px;color:#1d2b24;font-size:13px">${escapeMarketplaceHtml(reference)}</td></tr>` : ''}${amount ? `<tr><th align="left" style="padding:8px 12px;color:#68756f;font-size:13px;font-weight:600">Amount paid</th><td style="padding:8px 12px;color:#1d2b24;font-size:13px">KSh ${escapeMarketplaceHtml(amount)}</td></tr>` : ''}</table><h2 style="margin:25px 0 8px;color:#173b29;font-size:16px">Seller contact details</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e0e7e2">${sellerHtml || '<tr><td style="padding:12px;color:#53645a;font-size:13px">Contact the seller from the listing page.</td></tr>'}</table><p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e9e5;color:#68756f;font-size:11px;line-height:1.6">This message confirms a verified M-PESA transaction. MarketHub will never ask for your M-PESA PIN or one-time codes. For assistance, reply to this email.</p></td></tr></table></body></html>`
  return { subject: eventCopy.contact_unlock_payment_success.subject, text, html }
}

export function renderMarketplaceEmail(input: MarketplaceEmailInput): { subject: string; text: string; html: string } {
  const copy = eventCopy[input.kind]
  if (input.kind === 'contact_unlock_payment_success') return renderContactUnlockConfirmation(input)
  if (input.kind === 'admin_custom_message') {
    const subject = safeValue(input.data.subject, 180) || copy.subject
    const body = typeof input.data.body === 'string'
      ? input.data.body.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 5000).trim()
      : ''
    const htmlBody = body.split('\n').map((line) => `<p style="margin:0 0 14px;line-height:1.6;color:#25332d">${escapeMarketplaceHtml(line) || '&nbsp;'}</p>`).join('')
    return {
      subject,
      text: `${body}\n\nMarketHub Kenya`,
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeMarketplaceHtml(subject)}</title></head><body style="margin:0;background:#f2f5f0;color:#25332d;font-family:Arial,Helvetica,sans-serif"><main style="max-width:600px;margin:32px auto;padding:32px;background:#fff;border:1px solid #dce5dc"><p style="margin:0 0 24px;color:#1c6b45;font-weight:700">MarketHub Kenya</p>${htmlBody}<p style="margin:28px 0 0;color:#65736a;font-size:13px">This message was sent by an authorized MarketHub administrator.</p></main></body></html>`,
    }
  }
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
  const actionLabel = input.kind === 'marketplace_admin_invitation' ? 'Complete administrator onboarding' : input.kind === 'seller_password_reset' ? 'Reset password' : 'Verify email address'
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

export function getMarketplaceEmailProviderStatus(env: NodeJS.ProcessEnv = process.env): { provider: string; configured: boolean; code: string | null } {
  const provider = env.MARKETPLACE_EMAIL_PROVIDER ?? 'disabled'
  if (env.NODE_ENV === 'production' && provider !== 'smtp') return { provider, configured: false, code: 'BREVO_SMTP_REQUIRED' }
  if (provider === 'smtp') return { provider, configured: brevoConfig(env) !== null, code: brevoConfig(env) ? null : 'BREVO_SMTP_NOT_CONFIGURED' }
  if (provider === 'resend') {
    const configured = Boolean(env.MARKETPLACE_RESEND_API_KEY && env.MARKETPLACE_RESEND_FROM_EMAIL && validRecipient(env.MARKETPLACE_RESEND_FROM_EMAIL.trim()))
    return { provider, configured, code: configured ? null : 'RESEND_NOT_CONFIGURED' }
  }
  return { provider, configured: false, code: provider === 'disabled' ? 'EMAIL_PROVIDER_DISABLED' : 'EMAIL_PROVIDER_UNSUPPORTED' }
}

async function sendWithResend(message: MailMessage, env: NodeJS.ProcessEnv, dependencies: Dependencies): Promise<MarketplaceEmailDelivery> {
  const apiKey = env.MARKETPLACE_RESEND_API_KEY
  if (!apiKey || !env.MARKETPLACE_RESEND_FROM_EMAIL || !validRecipient(env.MARKETPLACE_RESEND_FROM_EMAIL.trim())) return { status: 'failed', code: 'RESEND_NOT_CONFIGURED' }
  const requestMessage: MailMessage = { ...message, from: { name: safeValue(env.MARKETPLACE_RESEND_FROM_NAME || 'MarketHub', 120), address: env.MARKETPLACE_RESEND_FROM_EMAIL.trim() } }
  try {
    const result = dependencies.sendResend
      ? await dependencies.sendResend(apiKey, requestMessage)
      : await (async () => {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `${requestMessage.from.name} <${requestMessage.from.address}>`,
            to: [requestMessage.to],
            subject: requestMessage.subject,
            text: requestMessage.text,
            html: requestMessage.html,
            ...(requestMessage.replyTo ? { reply_to: requestMessage.replyTo } : {}),
          }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) return { status: response.status }
        const body = await response.json() as { id?: string }
        return { status: response.status, id: body.id }
      })()
    if (result.status >= 200 && result.status < 300) return { status: 'sent', ...(result.id ? { providerMessageId: result.id } : {}) }
    if (result.status === 429) return { status: 'retry', code: 'RESEND_RATE_LIMITED' }
    if (result.status >= 500) return { status: 'uncertain', code: 'RESEND_OUTCOME_UNKNOWN' }
    return { status: 'failed', code: 'RESEND_REQUEST_REJECTED' }
  } catch {
    return { status: 'uncertain', code: 'RESEND_OUTCOME_UNKNOWN' }
  }
}

export async function sendMarketplaceEmail(input: MarketplaceEmailInput, dependencies: Dependencies = {}): Promise<MarketplaceEmailDelivery> {
  const env = dependencies.env ?? process.env
  if (!validRecipient(input.to)) return { status: 'failed', code: 'INVALID_RECIPIENT' }
  const rendered = renderMarketplaceEmail(input)
  const provider = env.MARKETPLACE_EMAIL_PROVIDER ?? 'disabled'
  if (env.NODE_ENV === 'production' && provider !== 'smtp') return { status: 'failed', code: 'BREVO_SMTP_REQUIRED' }
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

  if (provider === 'resend') {
    const configuredFrom = env.MARKETPLACE_RESEND_FROM_EMAIL?.trim()
    const message: MailMessage = {
      from: { name: safeValue(env.MARKETPLACE_RESEND_FROM_NAME || 'MarketHub', 120), address: configuredFrom || 'invalid@example.invalid' },
      to: input.to,
      ...rendered,
      ...(env.MARKETPLACE_EMAIL_REPLY_TO ? { replyTo: env.MARKETPLACE_EMAIL_REPLY_TO } : {}),
    }
    return sendWithResend(message, env, dependencies)
  }

  return { status: 'failed', code: provider === 'disabled' ? 'EMAIL_PROVIDER_DISABLED' : 'EMAIL_PROVIDER_UNSUPPORTED' }
}