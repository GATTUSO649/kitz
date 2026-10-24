import { z } from 'zod'

export function bcryptPasswordSchema(minLength: number) {
  return z.string().min(minLength).max(128).refine(
    (password) => Buffer.byteLength(password, 'utf8') <= 72,
    'Password must not exceed 72 UTF-8 bytes when using bcrypt.',
  )
}