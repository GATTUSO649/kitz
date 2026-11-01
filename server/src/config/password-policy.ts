import { compare } from 'bcryptjs'
import { z } from 'zod'

const dummyPasswordHash = '$2b$12$dMQb0c5TSqrGqBnLsWHg7OY1lpzjgTO9NlpziFmTtctDZ1deHspxi'

export function bcryptPasswordSchema(minLength: number) {
  return z.string().min(minLength).max(128).refine(
    (password) => Buffer.byteLength(password, 'utf8') <= 72,
    'Password must not exceed 72 UTF-8 bytes when using bcrypt.',
  )
}

export async function verifyPassword(password: string, passwordHash: string | null | undefined) {
  const matches = await compare(password, passwordHash ?? dummyPasswordHash)
  return passwordHash !== null && passwordHash !== undefined && matches
}