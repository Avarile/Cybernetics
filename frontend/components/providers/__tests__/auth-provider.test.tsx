import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { AuthProvider } from '@/components/providers/auth-provider'
import { useAuthStore } from '@/lib/state-management/auth.store'

beforeEach(() => {
  useAuthStore.setState({ status: 'idle' })
})

describe('AuthProvider', () => {
  it('calls bootstrap once on mount', () => {
    const spy = vi.spyOn(useAuthStore.getState(), 'bootstrap').mockResolvedValue()
    render(<AuthProvider><div>child</div></AuthProvider>)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
