import { describe, it, expect } from 'vitest'
import {
  computeExpiry, messagePreview, typeFromMime, buildMediaContent,
} from '../../../src/modules/whatsapp/whatsapp.chat.service.js'

describe('rolling retention', () => {
  it('expires N days after the LAST message', () => {
    const last = new Date('2026-10-09T10:00:00Z')
    expect(computeExpiry(last, 3).toISOString()).toBe('2026-10-12T10:00:00.000Z')
    expect(computeExpiry(last, 30).toISOString()).toBe('2026-11-08T10:00:00.000Z')
  })
  it('a newer message always pushes the expiry later', () => {
    expect(computeExpiry('2026-10-11T00:00:00Z', 3) > computeExpiry('2026-10-09T00:00:00Z', 3)).toBe(true)
  })
})

describe('previews + media', () => {
  it('previews text and files', () => {
    expect(messagePreview('text', '  hello \n world ')).toBe('hello world')
    expect(messagePreview('image', null)).toBe('📷 Photo')
    expect(messagePreview('document', 'bill.pdf')).toBe('📄 Document bill.pdf')
  })
  it('maps mime types', () => {
    expect(typeFromMime('image/png')).toBe('image')
    expect(typeFromMime('video/mp4')).toBe('video')
    expect(typeFromMime('audio/ogg')).toBe('audio')
    expect(typeFromMime('application/pdf')).toBe('document')
  })
  it('builds the right WhatsApp payload per file type', () => {
    const buffer = Buffer.from('x')
    expect(buildMediaContent({ buffer, mime: 'image/png', caption: 'hi' }).content).toMatchObject({ image: buffer, caption: 'hi' })
    expect(buildMediaContent({ buffer, mime: 'application/pdf', name: 'a.pdf' }).content).toMatchObject({ document: buffer, fileName: 'a.pdf' })
    expect(buildMediaContent({ buffer, mime: 'audio/ogg' }).content).toHaveProperty('audio')
  })
})
