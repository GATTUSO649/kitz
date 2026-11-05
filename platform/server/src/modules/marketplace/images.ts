import { createHash, randomUUID } from 'node:crypto'

export type VerifiedImage = { contentType: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number }

export function inspectImage(buffer: Buffer): VerifiedImage {
  let contentType: VerifiedImage['contentType'] | null = null
  let width = 0
  let height = 0
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString('ascii', 12, 16) === 'IHDR') {
    contentType = 'image/png'
    width = buffer.readUInt32BE(16)
    height = buffer.readUInt32BE(20)
  } else if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.toString('ascii', 12, 16) === 'VP8X') {
    contentType = 'image/webp'
    width = 1 + buffer.readUIntLE(24, 3)
    height = 1 + buffer.readUIntLE(27, 3)
  } else if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    contentType = 'image/jpeg'
    const dimensions = readJpegDimensions(buffer)
    width = dimensions.width
    height = dimensions.height
  }
  if (!contentType || width < 200 || height < 200 || width > 6000 || height > 6000 || width * height > 24_000_000) {
    throw new Error('Choose a valid JPEG, PNG or WebP image between 200px and 6000px per side.')
  }
  return { contentType, width, height }
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } {
  let offset = 2
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset++]
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break
    if (frameMarkers.has(marker)) {
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) }
    }
    offset += segmentLength
  }
  return { width: 0, height: 0 }
}

function cloudinarySignature(parameters: Record<string, string>, secret: string): string {
  const canonical = Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('&')
  return createHash('sha1').update(`${canonical}${secret}`).digest('hex')
}

export async function uploadMarketplaceImage(input: { buffer: Buffer; reference: string; order: number }): Promise<{ storageKey: string; imageUrl: string; contentType: VerifiedImage['contentType']; byteSize: number; width: number; height: number }> {
  const cloudName = process.env.MARKETPLACE_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.MARKETPLACE_CLOUDINARY_API_KEY
  const apiSecret = process.env.MARKETPLACE_CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) throw new Error('Marketplace persistent image storage is not configured.')
  const verified = inspectImage(input.buffer)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const publicId = `${input.reference.toLowerCase()}-${input.order + 1}-${randomUUID()}`
  const parameters = {
    eager: 'c_limit,w_2048,h_2048,f_webp,q_auto',
    folder: 'marketplace/listings',
    overwrite: 'false',
    public_id: publicId,
    timestamp,
  }
  const blobBytes = new ArrayBuffer(input.buffer.length)
  new Uint8Array(blobBytes).set(input.buffer)
  const form = new FormData()
  form.append('file', new Blob([blobBytes], { type: verified.contentType }), `${publicId}.${verified.contentType.split('/')[1]}`)
  form.append('api_key', apiKey)
  for (const [key, value] of Object.entries(parameters)) form.append(key, value)
  form.append('signature', cloudinarySignature(parameters, apiSecret))
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error('Marketplace image storage rejected the upload.')
  const stored = await response.json() as { public_id?: string; secure_url?: string; bytes?: number; width?: number; height?: number }
  if (!stored.public_id || !stored.secure_url?.startsWith('https://') || !stored.width || !stored.height) {
    throw new Error('Marketplace image storage returned an invalid image record.')
  }
  return {
    storageKey: stored.public_id,
    imageUrl: stored.secure_url,
    contentType: verified.contentType,
    byteSize: Number(stored.bytes ?? input.buffer.length),
    width: Number(stored.width),
    height: Number(stored.height),
  }
}

export async function deleteMarketplaceImage(storageKey: string): Promise<void> {
  const cloudName = process.env.MARKETPLACE_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.MARKETPLACE_CLOUDINARY_API_KEY
  const apiSecret = process.env.MARKETPLACE_CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) throw new Error('Marketplace persistent image storage is not configured.')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const parameters = { public_id: storageKey, timestamp }
  const form = new FormData()
  form.append('public_id', storageKey)
  form.append('timestamp', timestamp)
  form.append('api_key', apiKey)
  form.append('signature', cloudinarySignature(parameters, apiSecret))
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('Marketplace image storage could not delete the image.')
}
