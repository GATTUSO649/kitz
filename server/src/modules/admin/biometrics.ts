import { createHash, randomBytes } from 'node:crypto'
import { and, asc, count, eq, gt, isNotNull, isNull } from 'drizzle-orm'
import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { adminDb } from '../../config/database.js'
import { env, isAllowedClientOrigin } from '../../config/env.js'
import { verifyPassword } from '../../config/password-policy.js'
import { adminAuditLogs, adminBiometricChallenges, adminBiometricCredentials, adminBiometricEvents, adminLoginAttempts, adminSessions, adminUsers } from '../../database/admin-schema.js'
import { authenticateAdmin, authenticatedAdmin } from '../../middleware/authenticate.js'
import { createSecurityRateLimiter } from '../../security/distributed-rate-limit.js'
import { adminSessionAbsoluteLifetimeMs, adminSessionIdleTimeoutMs, nextSessionExpiry } from '../../config/session-policy.js'
import { setAdminSessionCookie } from './auth.js'
import { administratorPortal } from './administration.js'

const challengeLifetimeMs = 2 * 60_000
const freshAuthenticationWindowMs = 5 * 60_000
const failureWindowMs = 15 * 60_000
const maxFailures = 5
const challengeBytes = 32

export function webAuthnRelyingParty(origin = env.CLIENT_ORIGIN) {
  const parsedOrigin = new URL(origin)
  if (parsedOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname)) {
    throw new Error('WebAuthn requires HTTPS except on localhost.')
  }
  return { origin: parsedOrigin.origin, rpID: parsedOrigin.hostname, rpName: 'KitCulture IT Portal' }
}

export function biometricLockoutStatus(failures: number, oldestFailureAt: Date | null, now = new Date()) {
  if (failures < maxFailures) return { failures, lockedUntil: null }
  return { failures, lockedUntil: oldestFailureAt ? new Date(oldestFailureAt.getTime() + failureWindowMs) : new Date(now.getTime() + failureWindowMs) }
}

export function isBiometricChallengeConsumable(challenge: { expiresAt: Date; consumedAt: Date | null }, now = new Date()) {
  return challenge.consumedAt === null && challenge.expiresAt.getTime() > now.getTime()
}

export const adminBiometricsRouter = Router()
const optionLimiter = createSecurityRateLimiter('super-admin.webauthn-options', { windowMs: failureWindowMs, limit: 10, standardHeaders: true })
const verificationLimiter = createSecurityRateLimiter('super-admin.webauthn-verification', { windowMs: failureWindowMs, limit: 10, standardHeaders: true })
const revokeLimiter = createSecurityRateLimiter('super-admin.webauthn-revoke', { windowMs: failureWindowMs, limit: 5, standardHeaders: true })
const loginOptionsLimiter = createSecurityRateLimiter('super-admin.webauthn-login-options', { windowMs: failureWindowMs, limit: 10, standardHeaders: true })
const loginVerificationLimiter = createSecurityRateLimiter('super-admin.webauthn-login-verification', { windowMs: failureWindowMs, limit: 10, standardHeaders: true })

adminBiometricsRouter.use((request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || isAllowedClientOrigin(request.get('origin'))) {
    next()
    return
  }
  response.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } })
})

adminBiometricsRouter.post('/login/options', loginOptionsLimiter, async (_request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is unavailable.' } })
  const { rpID } = webAuthnRelyingParty()
  const options = await generateAuthenticationOptions({
    rpID,
    challenge: randomBytes(challengeBytes),
    timeout: challengeLifetimeMs,
    userVerification: 'required',
    allowCredentials: [],
  })
  const [challenge] = await adminDb.insert(adminBiometricChallenges).values({
    adminUserId: null,
    adminSessionId: null,
    purpose: 'login',
    challenge: options.challenge,
    expiresAt: new Date(Date.now() + challengeLifetimeMs),
  }).returning({ id: adminBiometricChallenges.id })
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: { options, challengeId: challenge.id } })
})

adminBiometricsRouter.post('/login/verify', loginVerificationLimiter, async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is unavailable.' } })
  const input = z.object({
    challengeId: z.number().int().positive(),
    response: z.record(z.string(), z.unknown()),
  }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_WEBAUTHN_RESPONSE', message: 'The authenticator response is invalid.' } })

  const challenge = await adminDb.transaction(async (transaction) => {
    const now = new Date()
    const [record] = await transaction.select({
      id: adminBiometricChallenges.id,
      challenge: adminBiometricChallenges.challenge,
      expiresAt: adminBiometricChallenges.expiresAt,
      consumedAt: adminBiometricChallenges.consumedAt,
    }).from(adminBiometricChallenges).where(and(
      eq(adminBiometricChallenges.id, input.data.challengeId),
      eq(adminBiometricChallenges.purpose, 'login'),
      isNull(adminBiometricChallenges.adminUserId),
      isNull(adminBiometricChallenges.adminSessionId),
      isNull(adminBiometricChallenges.consumedAt),
      gt(adminBiometricChallenges.expiresAt, now),
    )).for('update').limit(1)
    if (!record || !isBiometricChallengeConsumable(record, now)) return null
    const [consumed] = await transaction.update(adminBiometricChallenges).set({ consumedAt: now }).where(and(
      eq(adminBiometricChallenges.id, record.id),
      isNull(adminBiometricChallenges.consumedAt),
      gt(adminBiometricChallenges.expiresAt, now),
    )).returning({ id: adminBiometricChallenges.id })
    return consumed ? record.challenge : null
  })
  if (!challenge) {
    await writeEvent({ adminUserId: null, adminSessionId: null, eventType: 'authentication_failed', succeeded: false, failureCode: 'LOGIN_CHALLENGE_INVALID', sourceHash: biometricSourceHash(request.ip) })
    return response.status(400).json({ error: { code: 'CHALLENGE_INVALID_OR_EXPIRED', message: 'The sign-in challenge expired or was already used. Retry.' } })
  }

  const assertion = input.data.response as unknown as AuthenticationResponseJSON
  const [credential] = await adminDb.select({
    id: adminBiometricCredentials.id,
    adminUserId: adminBiometricCredentials.adminUserId,
    credentialId: adminBiometricCredentials.credentialId,
    publicKey: adminBiometricCredentials.publicKey,
    signCount: adminBiometricCredentials.signCount,
    transports: adminBiometricCredentials.transports,
    label: adminBiometricCredentials.label,
    email: adminUsers.email,
    fullName: adminUsers.fullName,
    roleNumber: adminUsers.roleNumber,
    role: adminUsers.role,
    status: adminUsers.status,
    emailVerifiedAt: adminUsers.emailVerifiedAt,
  }).from(adminBiometricCredentials).innerJoin(adminUsers, eq(adminUsers.id, adminBiometricCredentials.adminUserId))
    .where(and(
      eq(adminBiometricCredentials.credentialId, assertion.id),
      isNull(adminBiometricCredentials.revokedAt),
      eq(adminUsers.role, 'super_admin'),
      eq(adminUsers.status, 'active'),
      isNotNull(adminUsers.emailVerifiedAt),
    )).limit(1)

  const credentialTag = biometricSourceHash(assertion.id ?? 'unknown')
  if (!credential) {
    await writeEvent({ adminUserId: null, adminSessionId: null, eventType: 'authentication_failed', succeeded: false, failureCode: 'LOGIN_CREDENTIAL_REJECTED', sourceHash: biometricSourceHash(request.ip) })
    await adminDb.insert(adminLoginAttempts).values({ identity: `webauthn:${credentialTag.slice(0, 40)}`, success: false, failureCode: 'WEBAUTHN_LOGIN_REJECTED' })
    return response.status(401).json({ error: { code: 'AUTHENTICATION_REJECTED', message: 'No active Super-Admin authenticator matched this request.' } })
  }

  const attempts = await failedAttemptState(credential.adminUserId)
  if (attempts.lockedUntil) return response.status(423).json({ error: { code: 'BIOMETRIC_LOCKED', message: 'Too many verification attempts. Wait for the lockout to expire.', lockedUntil: attempts.lockedUntil.toISOString() } })

  try {
    const { origin, rpID } = webAuthnRelyingParty()
    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, 'base64url'),
        counter: credential.signCount,
        transports: credential.transports,
      },
      requireUserVerification: true,
    })
    if (!verification.verified || !verification.authenticationInfo.userVerified) throw new Error('USER_VERIFICATION_REQUIRED')

    const now = new Date()
    const token = randomBytes(32).toString('base64url')
    const expiresAt = nextSessionExpiry(now, now, adminSessionIdleTimeoutMs, adminSessionAbsoluteLifetimeMs)!
    await adminDb.transaction(async (transaction) => {
      const currentCredential = await transaction.update(adminBiometricCredentials).set({
        signCount: verification.authenticationInfo.newCounter,
        lastUsedAt: now,
      }).where(and(
        eq(adminBiometricCredentials.id, credential.id),
        eq(adminBiometricCredentials.adminUserId, credential.adminUserId),
        isNull(adminBiometricCredentials.revokedAt),
      )).returning({ id: adminBiometricCredentials.id })
      if (currentCredential.length !== 1) throw new Error('CREDENTIAL_REVOKED')
      const [session] = await transaction.insert(adminSessions).values({
        adminUserId: credential.adminUserId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt,
        webauthnVerifiedAt: now,
        createdAt: now,
      }).returning({ id: adminSessions.id })
      await transaction.insert(adminBiometricEvents).values({ adminUserId: credential.adminUserId, adminSessionId: session.id, eventType: 'authentication_succeeded', succeeded: true })
      await transaction.insert(adminAuditLogs).values({ adminUserId: credential.adminUserId, action: 'admin.webauthn_login', targetType: 'admin_user', targetId: String(credential.adminUserId) })
      await transaction.insert(adminLoginAttempts).values({ identity: credential.email, adminUserId: credential.adminUserId, success: true })
      await transaction.update(adminUsers).set({ lastLoginAt: now }).where(eq(adminUsers.id, credential.adminUserId))
    })
    setAdminSessionCookie(response, token)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: {
      user: { id: credential.adminUserId, email: credential.email, fullName: credential.fullName, roleNumber: credential.roleNumber, role: credential.role },
      portal: administratorPortal('super_admin'),
      deviceLabel: credential.label,
    } })
  } catch (error) {
    const failureCode = error instanceof Error ? error.message.slice(0, 80) : 'AUTHENTICATION_REJECTED'
    await writeEvent({ adminUserId: credential.adminUserId, adminSessionId: null, eventType: 'authentication_failed', succeeded: false, failureCode, sourceHash: biometricSourceHash(request.ip) })
    await adminDb.insert(adminLoginAttempts).values({ identity: credential.email, adminUserId: credential.adminUserId, success: false, failureCode: 'WEBAUTHN_LOGIN_REJECTED' })
    const currentAttempts = await failedAttemptState(credential.adminUserId)
    if (currentAttempts.lockedUntil) return response.status(423).json({ error: { code: 'BIOMETRIC_LOCKED', message: 'Too many verification attempts. Wait for the lockout to expire.', lockedUntil: currentAttempts.lockedUntil.toISOString() } })
    response.status(401).json({ error: { code: 'AUTHENTICATION_REJECTED', message: 'The authenticator could not be verified. No administrator session was created.' } })
  }
})

adminBiometricsRouter.use(authenticateAdmin, (request, response, next) => {
  const actor = authenticatedAdmin(request)
  if (!actor || actor.role !== 'super_admin' || actor.status !== 'active') {
    response.status(403).json({ error: { code: 'SUPER_ADMIN_REQUIRED', message: 'Super Administrator access is required.' } })
    return
  }
  next()
})

export const requireFreshSuperAdminWebAuthn: RequestHandler = async (request, response, next) => {
  const actor = authenticatedAdmin(request)
  if (!actor || actor.role !== 'super_admin') {
    next()
    return
  }
  if (!adminDb) {
    response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is unavailable.' } })
    return
  }
  const [result] = await adminDb.select({ total: count() }).from(adminBiometricCredentials).where(and(
    eq(adminBiometricCredentials.adminUserId, actor.id),
    isNull(adminBiometricCredentials.revokedAt),
  ))
  if (!Number(result?.total ?? 0)) {
    response.status(428).json({ error: { code: 'BIOMETRIC_ENROLLMENT_REQUIRED', message: 'Register a platform authenticator before using Super Administrator controls.' } })
    return
  }
  if (!sessionVerificationIsFresh(actor.webauthnVerifiedAt)) {
    response.status(428).json({ error: { code: 'BIOMETRIC_VERIFICATION_REQUIRED', message: 'Verify your platform authenticator before continuing.' } })
    return
  }
  next()
}

function actorFor(request: Parameters<typeof authenticateAdmin>[0]) {
  return authenticatedAdmin(request)!
}

async function activeCredentials(adminUserId: number) {
  if (!adminDb) return []
  return adminDb.select({
    id: adminBiometricCredentials.id,
    credentialId: adminBiometricCredentials.credentialId,
    publicKey: adminBiometricCredentials.publicKey,
    signCount: adminBiometricCredentials.signCount,
    transports: adminBiometricCredentials.transports,
    deviceType: adminBiometricCredentials.deviceType,
    backedUp: adminBiometricCredentials.backedUp,
    label: adminBiometricCredentials.label,
    createdAt: adminBiometricCredentials.createdAt,
    lastUsedAt: adminBiometricCredentials.lastUsedAt,
  }).from(adminBiometricCredentials).where(and(
    eq(adminBiometricCredentials.adminUserId, adminUserId),
    isNull(adminBiometricCredentials.revokedAt),
  ))
}

async function failedAttemptState(adminUserId: number, now = new Date()) {
  if (!adminDb) return { failures: maxFailures, lockedUntil: now }
  const threshold = new Date(now.getTime() - failureWindowMs)
  const [result] = await adminDb.select({ total: count() }).from(adminBiometricEvents).where(and(
    eq(adminBiometricEvents.adminUserId, adminUserId),
    eq(adminBiometricEvents.eventType, 'authentication_failed'),
    eq(adminBiometricEvents.succeeded, false),
    gt(adminBiometricEvents.createdAt, threshold),
  ))
  const failures = Number(result?.total ?? 0)
  if (failures < maxFailures) return { failures, lockedUntil: null }
  const [oldest] = await adminDb.select({ createdAt: adminBiometricEvents.createdAt }).from(adminBiometricEvents).where(and(
    eq(adminBiometricEvents.adminUserId, adminUserId),
    eq(adminBiometricEvents.eventType, 'authentication_failed'),
    eq(adminBiometricEvents.succeeded, false),
    gt(adminBiometricEvents.createdAt, threshold),
  )).orderBy(asc(adminBiometricEvents.createdAt)).limit(1)
  return biometricLockoutStatus(failures, oldest?.createdAt ?? null, now)
}

async function writeEvent(input: {
  adminUserId: number | null
  adminSessionId: number | null
  eventType: string
  succeeded: boolean
  failureCode?: string
  sourceHash?: string
}) {
  if (!adminDb) return
  await adminDb.insert(adminBiometricEvents).values({
    adminUserId: input.adminUserId,
    adminSessionId: input.adminSessionId,
    eventType: input.eventType,
    succeeded: input.succeeded,
    failureCode: input.failureCode ?? null,
    sourceHash: input.sourceHash ?? null,
  })
}

async function saveChallenge(adminUserId: number, adminSessionId: number, purpose: 'registration' | 'authentication', challenge: string) {
  if (!adminDb) return
  const now = new Date()
  await adminDb.delete(adminBiometricChallenges).where(and(
    eq(adminBiometricChallenges.adminSessionId, adminSessionId),
    eq(adminBiometricChallenges.purpose, purpose),
  ))
  await adminDb.insert(adminBiometricChallenges).values({
    adminUserId,
    adminSessionId,
    purpose,
    challenge,
    expiresAt: new Date(now.getTime() + challengeLifetimeMs),
  })
}

async function consumeChallenge(adminUserId: number, adminSessionId: number, purpose: 'registration' | 'authentication') {
  if (!adminDb) return null
  return adminDb.transaction(async (transaction) => {
    const now = new Date()
    const [challenge] = await transaction.select({ id: adminBiometricChallenges.id, challenge: adminBiometricChallenges.challenge, expiresAt: adminBiometricChallenges.expiresAt, consumedAt: adminBiometricChallenges.consumedAt })
      .from(adminBiometricChallenges).where(and(
        eq(adminBiometricChallenges.adminUserId, adminUserId),
        eq(adminBiometricChallenges.adminSessionId, adminSessionId),
        eq(adminBiometricChallenges.purpose, purpose),
        isNull(adminBiometricChallenges.consumedAt),
        gt(adminBiometricChallenges.expiresAt, now),
      )).for('update').limit(1)
    if (!challenge || !isBiometricChallengeConsumable(challenge, now)) return null
    const consumed = await transaction.update(adminBiometricChallenges).set({ consumedAt: now }).where(and(
      eq(adminBiometricChallenges.id, challenge.id),
      isNull(adminBiometricChallenges.consumedAt),
      gt(adminBiometricChallenges.expiresAt, now),
    )).returning({ id: adminBiometricChallenges.id })
    return consumed.length === 1 ? challenge.challenge : null
  })
}

function sessionVerificationIsFresh(verifiedAt: Date | null | undefined, windowMs = freshAuthenticationWindowMs) {
  if (!verifiedAt) return false
  const age = Date.now() - verifiedAt.getTime()
  return age >= 0 && age <= windowMs
}

adminBiometricsRouter.get('/status', async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is unavailable.' } })
  const actor = actorFor(request)
  const credentials = await activeCredentials(actor.id)
  const attempts = await failedAttemptState(actor.id)
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: {
    enrolled: credentials.length > 0,
    verified: sessionVerificationIsFresh(actor.webauthnVerifiedAt),
    verifiedAt: actor.webauthnVerifiedAt?.toISOString() ?? null,
    enrollmentAllowed: credentials.length === 0
      ? Date.now() - actor.sessionCreatedAt.getTime() <= freshAuthenticationWindowMs
      : sessionVerificationIsFresh(actor.webauthnVerifiedAt),
    lockedUntil: attempts.lockedUntil?.toISOString() ?? null,
    attemptsRemaining: Math.max(0, maxFailures - attempts.failures),
    modality: 'platform-authenticator-user-verification',
    fingerprintSpecific: false,
  } })
})

adminBiometricsRouter.get('/devices', async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is unavailable.' } })
  const actor = actorFor(request)
  const devices = await activeCredentials(actor.id)
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: devices.map(({ id, credentialId, label, deviceType, backedUp, createdAt, lastUsedAt }) => ({
    id,
    credentialId,
    label,
    deviceType,
    backedUp,
    createdAt: createdAt.toISOString(),
    lastUsedAt: lastUsedAt?.toISOString() ?? null,
  })) })
})

adminBiometricsRouter.post('/register/options', optionLimiter, async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is unavailable.' } })
  const actor = actorFor(request)
  const credentials = await activeCredentials(actor.id)
  if (credentials.length && !sessionVerificationIsFresh(actor.webauthnVerifiedAt)) {
    return response.status(403).json({ error: { code: 'BIOMETRIC_REAUTH_REQUIRED', message: 'Verify an enrolled authenticator before adding another device.' } })
  }
  if (!credentials.length && Date.now() - actor.sessionCreatedAt.getTime() > freshAuthenticationWindowMs) {
    return response.status(403).json({ error: { code: 'PASSWORD_REAUTH_REQUIRED', message: 'Sign in again before enrolling an authenticator.' } })
  }
  const { rpID, rpName } = webAuthnRelyingParty()
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(String(actor.id)),
    userName: actor.email,
    userDisplayName: actor.fullName,
    challenge: randomBytes(challengeBytes),
    timeout: challengeLifetimeMs,
    attestationType: 'none',
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
    preferredAuthenticatorType: 'localDevice',
    excludeCredentials: credentials.map(({ credentialId, transports }) => ({ id: credentialId, transports })),
  })
  await saveChallenge(actor.id, actor.sessionId, 'registration', options.challenge)
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: options })
})

adminBiometricsRouter.post('/register/verify', verificationLimiter, async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is unavailable.' } })
  const input = z.object({
    response: z.record(z.string(), z.unknown()),
    label: z.string().trim().min(1).max(100).default('This device'),
  }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_WEBAUTHN_RESPONSE', message: 'The authenticator response is invalid.' } })
  const actor = actorFor(request)
  const challenge = await consumeChallenge(actor.id, actor.sessionId, 'registration')
  if (!challenge) {
    await writeEvent({ adminUserId: actor.id, adminSessionId: actor.sessionId, eventType: 'registration_failed', succeeded: false, failureCode: 'CHALLENGE_INVALID_OR_EXPIRED', sourceHash: biometricSourceHash(request.ip) })
    return response.status(400).json({ error: { code: 'CHALLENGE_INVALID_OR_EXPIRED', message: 'The registration challenge expired or was already used. Retry enrollment.' } })
  }
  try {
    const { origin, rpID } = webAuthnRelyingParty()
    const responseJSON = input.data.response as unknown as RegistrationResponseJSON
    const verification = await verifyRegistrationResponse({
      response: responseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    })
    if (!verification.verified || !verification.registrationInfo.userVerified) throw new Error('USER_VERIFICATION_REQUIRED')
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
    const existing = await adminDb.select({ id: adminBiometricCredentials.id }).from(adminBiometricCredentials)
      .where(eq(adminBiometricCredentials.credentialId, credential.id)).limit(1)
    if (existing.length) return response.status(409).json({ error: { code: 'CREDENTIAL_ALREADY_REGISTERED', message: 'This authenticator is already registered.' } })
    await adminDb.transaction(async (transaction) => {
      await transaction.insert(adminBiometricCredentials).values({
        adminUserId: actor.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        signCount: credential.counter,
        transports: responseJSON.response.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        label: input.data.label,
      })
      const currentSession = await transaction.update(adminSessions).set({ webauthnVerifiedAt: new Date() }).where(and(
        eq(adminSessions.id, actor.sessionId),
        eq(adminSessions.adminUserId, actor.id),
        gt(adminSessions.expiresAt, new Date()),
      )).returning({ id: adminSessions.id })
      if (currentSession.length !== 1) throw new Error('ADMIN_SESSION_REVOKED')
      await transaction.insert(adminBiometricEvents).values({ adminUserId: actor.id, adminSessionId: actor.sessionId, eventType: 'credential_registered', succeeded: true })
      await transaction.insert(adminAuditLogs).values({ adminUserId: actor.id, action: 'super_admin.authenticator_registered', targetType: 'admin_user', targetId: String(actor.id) })
    })
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: { verified: true, deviceLabel: input.data.label, fingerprintSpecific: false } })
  } catch (error) {
    await writeEvent({ adminUserId: actor.id, adminSessionId: actor.sessionId, eventType: 'registration_failed', succeeded: false, failureCode: error instanceof Error ? error.name.slice(0, 80) : 'REGISTRATION_REJECTED', sourceHash: biometricSourceHash(request.ip) })
    response.status(400).json({ error: { code: 'REGISTRATION_REJECTED', message: 'The authenticator could not be verified. No biometric data was stored.' } })
  }
})

adminBiometricsRouter.post('/authenticate/options', optionLimiter, async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is unavailable.' } })
  const actor = actorFor(request)
  const attempts = await failedAttemptState(actor.id)
  if (attempts.lockedUntil) return response.status(423).json({ error: { code: 'BIOMETRIC_LOCKED', message: 'Too many verification attempts. Wait for the lockout to expire.', lockedUntil: attempts.lockedUntil.toISOString() } })
  const credentials = await activeCredentials(actor.id)
  if (!credentials.length) return response.status(409).json({ error: { code: 'BIOMETRIC_ENROLLMENT_REQUIRED', message: 'Register a platform authenticator before verifying this session.' } })
  const { rpID } = webAuthnRelyingParty()
  const options = await generateAuthenticationOptions({
    rpID,
    challenge: randomBytes(challengeBytes),
    timeout: challengeLifetimeMs,
    userVerification: 'required',
    allowCredentials: credentials.map(({ credentialId, transports }) => ({ id: credentialId, transports })),
  })
  await saveChallenge(actor.id, actor.sessionId, 'authentication', options.challenge)
  response.setHeader('Cache-Control', 'no-store')
  response.json({ data: options })
})

adminBiometricsRouter.post('/authenticate/verify', verificationLimiter, async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is unavailable.' } })
  const input = z.object({ response: z.record(z.string(), z.unknown()) }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_WEBAUTHN_RESPONSE', message: 'The authenticator response is invalid.' } })
  const actor = actorFor(request)
  const challenge = await consumeChallenge(actor.id, actor.sessionId, 'authentication')
  if (!challenge) {
    await writeEvent({ adminUserId: actor.id, adminSessionId: actor.sessionId, eventType: 'authentication_failed', succeeded: false, failureCode: 'CHALLENGE_INVALID_OR_EXPIRED', sourceHash: biometricSourceHash(request.ip) })
    return response.status(400).json({ error: { code: 'CHALLENGE_INVALID_OR_EXPIRED', message: 'The authentication challenge expired or was already used. Retry verification.' } })
  }
  try {
    const responseJSON = input.data.response as unknown as AuthenticationResponseJSON
    const credentials = await activeCredentials(actor.id)
    const credential = credentials.find((candidate) => candidate.credentialId === responseJSON.id)
    if (!credential) throw new Error('CREDENTIAL_NOT_OWNED')
    const { origin, rpID } = webAuthnRelyingParty()
    const verification = await verifyAuthenticationResponse({
      response: responseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, 'base64url'),
        counter: credential.signCount,
        transports: credential.transports,
      },
      requireUserVerification: true,
    })
    if (!verification.verified || !verification.authenticationInfo.userVerified) throw new Error('USER_VERIFICATION_REQUIRED')
    const usedAt = new Date()
    await adminDb.transaction(async (transaction) => {
      const currentCredential = await transaction.update(adminBiometricCredentials).set({ signCount: verification.authenticationInfo.newCounter, lastUsedAt: usedAt })
        .where(and(eq(adminBiometricCredentials.id, credential.id), eq(adminBiometricCredentials.adminUserId, actor.id), isNull(adminBiometricCredentials.revokedAt)))
        .returning({ id: adminBiometricCredentials.id })
      const currentSession = await transaction.update(adminSessions).set({ webauthnVerifiedAt: usedAt }).where(and(
        eq(adminSessions.id, actor.sessionId),
        eq(adminSessions.adminUserId, actor.id),
        gt(adminSessions.expiresAt, usedAt),
      )).returning({ id: adminSessions.id })
      if (currentCredential.length !== 1 || currentSession.length !== 1) throw new Error('CREDENTIAL_OR_SESSION_REVOKED')
      await transaction.insert(adminBiometricEvents).values({ adminUserId: actor.id, adminSessionId: actor.sessionId, eventType: 'authentication_succeeded', succeeded: true })
      await transaction.insert(adminAuditLogs).values({ adminUserId: actor.id, action: 'super_admin.authenticator_verified', targetType: 'admin_user', targetId: String(actor.id) })
    })
    response.setHeader('Cache-Control', 'no-store')
    response.json({ data: { verified: true, verifiedAt: usedAt.toISOString(), deviceLabel: credential.label, fingerprintSpecific: false } })
  } catch (error) {
    const failureCode = error instanceof Error ? error.message.slice(0, 80) : 'AUTHENTICATION_REJECTED'
    await writeEvent({ adminUserId: actor.id, adminSessionId: actor.sessionId, eventType: 'authentication_failed', succeeded: false, failureCode, sourceHash: biometricSourceHash(request.ip) })
    const attempts = await failedAttemptState(actor.id)
    if (attempts.lockedUntil) return response.status(423).json({ error: { code: 'BIOMETRIC_LOCKED', message: 'Too many verification attempts. Wait for the lockout to expire.', lockedUntil: attempts.lockedUntil.toISOString() } })
    response.status(401).json({ error: { code: 'AUTHENTICATION_REJECTED', message: 'The authenticator could not be verified. No administrator access was granted.' } })
  }
})

adminBiometricsRouter.post('/revoke', revokeLimiter, async (request, response) => {
  if (!adminDb) return response.status(503).json({ error: { code: 'ADMIN_DATABASE_UNAVAILABLE', message: 'Administrator authentication is unavailable.' } })
  const input = z.object({ credentialId: z.string().min(1).max(1024).optional(), password: z.string().min(1).max(128) }).strict().safeParse(request.body)
  if (!input.success) return response.status(400).json({ error: { code: 'INVALID_REVOCATION', message: 'Confirm your password to revoke an authenticator.' } })
  const actor = actorFor(request)
  const [admin] = await adminDb.select({ passwordHash: adminUsers.passwordHash }).from(adminUsers).where(eq(adminUsers.id, actor.id)).limit(1)
  if (!admin || !await verifyPassword(input.data.password, admin.passwordHash)) {
    await writeEvent({ adminUserId: actor.id, adminSessionId: actor.sessionId, eventType: 'credential_revoked', succeeded: false, failureCode: 'PASSWORD_REAUTH_FAILED', sourceHash: biometricSourceHash(request.ip) })
    return response.status(401).json({ error: { code: 'PASSWORD_REAUTH_FAILED', message: 'The password was not accepted. No authenticator was revoked.' } })
  }
  const now = new Date()
  const active = await activeCredentials(actor.id)
  const target = input.data.credentialId ? active.filter(({ credentialId }) => credentialId === input.data.credentialId) : active
  const remaining = active.length - target.length
  if (input.data.credentialId && !target.length) return response.status(404).json({ error: { code: 'CREDENTIAL_NOT_FOUND', message: 'The active authenticator was not found.' } })
  if (!target.length) return response.status(404).json({ error: { code: 'CREDENTIAL_NOT_FOUND', message: 'No active authenticator was found.' } })
  await adminDb.transaction(async (transaction) => {
    if (input.data.credentialId) {
      await transaction.update(adminBiometricCredentials).set({ revokedAt: now }).where(and(
        eq(adminBiometricCredentials.adminUserId, actor.id),
        eq(adminBiometricCredentials.credentialId, input.data.credentialId),
        isNull(adminBiometricCredentials.revokedAt),
      ))
    } else {
      await transaction.update(adminBiometricCredentials).set({ revokedAt: now }).where(and(
        eq(adminBiometricCredentials.adminUserId, actor.id),
        isNull(adminBiometricCredentials.revokedAt),
      ))
    }
    await transaction.update(adminSessions).set({ webauthnVerifiedAt: null }).where(eq(adminSessions.adminUserId, actor.id))
    await transaction.insert(adminBiometricEvents).values({ adminUserId: actor.id, adminSessionId: actor.sessionId, eventType: 'credential_revoked', succeeded: true })
    await transaction.insert(adminAuditLogs).values({ adminUserId: actor.id, action: 'super_admin.authenticator_revoked', targetType: 'admin_user', targetId: String(actor.id) })
  })
  response.json({ data: { revoked: target.length, remaining, passwordReauthenticated: true, recoveryRequired: remaining === 0 } })
})

export function biometricSourceHash(value: string | undefined) {
  return createHash('sha256').update(value ?? 'unknown').digest('hex')
}
