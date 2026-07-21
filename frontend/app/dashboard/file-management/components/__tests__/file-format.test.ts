import { describe, it, expect } from 'vitest'
import { formatBytes, mimeLabel, quarantineReason } from '@/app/dashboard/file-management/components/file-format'

describe('formatBytes', () => {
  it('formats across units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
  })
})

describe('mimeLabel', () => {
  it('shortens common types and falls back to subtype', () => {
    expect(mimeLabel('application/pdf')).toBe('PDF')
    expect(mimeLabel('image/png')).toBe('PNG')
    expect(mimeLabel('application/vnd.custom+json')).toBe('vnd.custom+json')
  })
})

describe('quarantineReason', () => {
  it('reads a string reason or returns null', () => {
    expect(quarantineReason({ quarantineReason: 'mime-mismatch' })).toBe('mime-mismatch')
    expect(quarantineReason({})).toBeNull()
  })
})
