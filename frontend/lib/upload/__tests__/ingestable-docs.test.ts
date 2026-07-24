import { describe, it, expect } from 'vitest'
import { isIngestableDoc, partitionIngestable } from '@/lib/upload/ingestable-docs'

const file = (name: string, type = '') => new File(['x'], name, { type })

describe('isIngestableDoc', () => {
  it('accepts by MIME and by extension (incl. empty-type .md)', () => {
    expect(isIngestableDoc(file('a.pdf', 'application/pdf'))).toBe(true)
    expect(isIngestableDoc(file('notes.md', ''))).toBe(true)
    expect(isIngestableDoc(file('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBe(true)
    expect(isIngestableDoc(file('pic.png', 'image/png'))).toBe(false)
  })
  it('partitions files', () => {
    const { accepted, rejected } = partitionIngestable([file('a.pdf', 'application/pdf'), file('b.png', 'image/png')])
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf'])
    expect(rejected.map((f) => f.name)).toEqual(['b.png'])
  })
})
