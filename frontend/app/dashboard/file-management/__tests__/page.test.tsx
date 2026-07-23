import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/dashboard/file-management/components/file-management-view', () => ({
  FileManagementView: () => <div>file-management-view</div>,
}))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => <div>sidebar</div> }))
vi.mock('@/components/site-header', () => ({ SiteHeader: () => <div>header</div> }))

import Page from '@/app/dashboard/file-management/page'

describe('File management page', () => {
  it('renders the view', () => {
    render(<Page />)
    expect(screen.getByText('file-management-view')).toBeInTheDocument()
  })
})
