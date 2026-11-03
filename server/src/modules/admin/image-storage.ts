import { createHash } from 'node:crypto'
import { env } from '../../config/env.js'
import { recordProviderMeasurement } from '../operations/monitoring-recorder.js'

const maxImageBytes = 8 * 1024 * 1024

type CloudinaryAsset = {
  public_id: string
  secure_url: string
  format: string
  bytes: number
  width: number
  height: number
}

export class ImageStorageError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message)
    this.name = 'ImageStorageError'
  }
}

export function detectImageFormat(bytes: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

function configuration() {
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env
  if (!cloudName || !apiKey || !apiSecret) {
    throw new ImageStorageError('Persistent image storage is not configured. Set the Cloudinary environment variables.', 503)
  }
  return { cloudName, apiKey, apiSecret }
}

function signedParameters(parameters: Record<string, string>, secret: string) {
  const canonical = Object.entries(parameters)
    .filter(([, value]) => value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return createHash('sha1').update(`${canonical}${secret}`).digest('hex')
}

async function uploadImage(folder: string, publicId: string, bytes: Buffer): Promise<CloudinaryAsset> {
  if (bytes.length === 0) throw new ImageStorageError('Choose a non-empty image file.', 400)
  if (bytes.length > maxImageBytes) throw new ImageStorageError('Images must be 8 MB or smaller.', 413)
  const format = detectImageFormat(bytes)
  if (!format) throw new ImageStorageError('Upload a valid JPEG, PNG, or WebP image.', 415)
  const { cloudName, apiKey, apiSecret } = configuration()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const parameters = { folder, public_id: publicId, timestamp }
  const form = new FormData()
  form.set('file', new Blob([Uint8Array.from(bytes)], { type: `image/${format === 'jpg' ? 'jpeg' : format}` }), `upload.${format}`)
  form.set('api_key', apiKey)
  form.set('timestamp', timestamp)
  form.set('folder', folder)
  form.set('public_id', publicId)
  form.set('signature', signedParameters(parameters, apiSecret))

  let response: Response
  const startedAt = Date.now()
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    recordProviderMeasurement({ provider: 'cloudinary', operation: 'image_upload', durationMs: Date.now() - startedAt, outcome: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error' })
    throw new ImageStorageError('Image storage could not be reached. Try again.')
  }
  let result: Partial<CloudinaryAsset> & { error?: { message?: string } }
  try {
    result = await response.json() as Partial<CloudinaryAsset> & { error?: { message?: string } }
  } catch {
    recordProviderMeasurement({ provider: 'cloudinary', operation: 'image_upload', durationMs: Date.now() - startedAt, outcome: 'rejected', httpStatus: response.status })
    throw new ImageStorageError('Image storage returned an invalid response.')
  }
  if (!response.ok || typeof result.public_id !== 'string' || typeof result.secure_url !== 'string'
    || typeof result.format !== 'string' || typeof result.bytes !== 'number'
    || typeof result.width !== 'number' || typeof result.height !== 'number') {
    recordProviderMeasurement({ provider: 'cloudinary', operation: 'image_upload', durationMs: Date.now() - startedAt, outcome: 'rejected', httpStatus: response.status })
    throw new ImageStorageError('Image storage rejected the upload.')
  }
  recordProviderMeasurement({ provider: 'cloudinary', operation: 'image_upload', durationMs: Date.now() - startedAt, outcome: 'response_received', httpStatus: response.status })
  return {
    public_id: result.public_id,
    secure_url: result.secure_url,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
  }
}

export function uploadProductImage(productId: number, bytes: Buffer): Promise<CloudinaryAsset> {
  return uploadImage('kitculture/products', `product-${productId}-${crypto.randomUUID()}`, bytes)
}

export function uploadHomepageSlideImage(bytes: Buffer): Promise<CloudinaryAsset> {
  return uploadImage('kitculture/homepage', `homepage-${crypto.randomUUID()}`, bytes)
}

export async function deleteProductImage(publicId: string): Promise<void> {
  const { cloudName, apiKey, apiSecret } = configuration()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const parameters = { public_id: publicId, timestamp }
  const form = new FormData()
  form.set('api_key', apiKey)
  form.set('public_id', publicId)
  form.set('timestamp', timestamp)
  form.set('signature', signedParameters(parameters, apiSecret))

  let response: Response
  const startedAt = Date.now()
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`, { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    recordProviderMeasurement({ provider: 'cloudinary', operation: 'image_delete', durationMs: Date.now() - startedAt, outcome: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network_error' })
    throw new ImageStorageError('Image storage could not be reached. Try again.')
  }
  let result: { result?: string; error?: { message?: string } }
  try {
    result = await response.json() as { result?: string; error?: { message?: string } }
  } catch {
    recordProviderMeasurement({ provider: 'cloudinary', operation: 'image_delete', durationMs: Date.now() - startedAt, outcome: 'rejected', httpStatus: response.status })
    throw new ImageStorageError('Image storage returned an invalid response.')
  }
  if (!response.ok || !['ok', 'not found'].includes(result.result ?? '')) {
    recordProviderMeasurement({ provider: 'cloudinary', operation: 'image_delete', durationMs: Date.now() - startedAt, outcome: 'rejected', httpStatus: response.status })
    throw new ImageStorageError('Image could not be deleted from storage.')
  }
  recordProviderMeasurement({ provider: 'cloudinary', operation: 'image_delete', durationMs: Date.now() - startedAt, outcome: 'response_received', httpStatus: response.status })
}
