import type { Response } from 'express'

type ChatEvent = 'chat-message' | 'message-receipt' | 'presence'
type ChatMessageEvent = { conversationId: number; customerId: number; senderType: 'customer' | 'admin' }

const customerStreams = new Map<number, Set<Response>>()
const adminStreams = new Map<number, Set<Response>>()

function writeEvent(response: Response, event: ChatEvent, data: unknown) {
  if (!response.writableEnded && !response.destroyed) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}

function broadcast(streams: Map<number, Set<Response>>, event: ChatEvent, data: unknown) {
  for (const responses of streams.values()) {
    for (const response of responses) writeEvent(response, event, data)
  }
}

function totalStreams(streams: Map<number, Set<Response>>) {
  return Array.from(streams.values()).reduce((total, responses) => total + responses.size, 0)
}

function onlineCustomerIds() {
  return Array.from(customerStreams.entries()).filter(([, responses]) => responses.size > 0).map(([customerId]) => customerId)
}

function syncAdminPresence() {
  broadcast(adminStreams, 'presence', { onlineCustomerIds: onlineCustomerIds() })
}

function registerStream(streams: Map<number, Set<Response>>, ownerId: number, response: Response, onChange: () => void) {
  const responses = streams.get(ownerId) ?? new Set<Response>()
  responses.add(response)
  streams.set(ownerId, responses)
  const heartbeat = setInterval(() => {
    if (!response.writableEnded && !response.destroyed) response.write(': keepalive\n\n')
  }, 20000)
  onChange()

  response.on('close', () => {
    clearInterval(heartbeat)
    responses.delete(response)
    if (!responses.size) streams.delete(ownerId)
    onChange()
  })
}

export function registerCustomerStream(customerId: number, response: Response) {
  registerStream(customerStreams, customerId, response, () => {
    writeEvent(response, 'presence', { adminOnline: totalStreams(adminStreams) > 0 })
    syncAdminPresence()
  })
}

export function registerAdminStream(adminId: number, response: Response) {
  registerStream(adminStreams, adminId, response, () => {
    writeEvent(response, 'presence', { onlineCustomerIds: onlineCustomerIds() })
    if (totalStreams(adminStreams) > 0) broadcast(customerStreams, 'presence', { adminOnline: true })
    else broadcast(customerStreams, 'presence', { adminOnline: false })
  })
}

export function publishChatMessage(event: ChatMessageEvent) {
  if (event.senderType === 'customer') {
    broadcast(adminStreams, 'chat-message', event)
    return
  }
  const recipients = customerStreams.get(event.customerId)
  if (recipients) {
    for (const response of recipients) writeEvent(response, 'chat-message', event)
  }
  broadcast(adminStreams, 'chat-message', event)
}

export function isAdminOnline() {
  return totalStreams(adminStreams) > 0
}

export function isCustomerOnline(customerId: number) {
  return (customerStreams.get(customerId)?.size ?? 0) > 0
}

export function publishMessageReceipt(event: ChatMessageEvent) {
  const recipients = event.senderType === 'customer' ? customerStreams.get(event.customerId) : null
  if (recipients) {
    for (const response of recipients) writeEvent(response, 'message-receipt', event)
  }
  if (event.senderType === 'admin') broadcast(adminStreams, 'message-receipt', event)
}
