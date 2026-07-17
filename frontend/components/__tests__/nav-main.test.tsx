import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NavMain } from '@/components/nav-main'

describe('NavMain', () => {
  it('renders each item as a navigable link to its url', () => {
    render(
      <TooltipProvider>
        <SidebarProvider>
          <NavMain items={[{ title: 'Data Management', url: '/dashboard/data-management' }]} />
        </SidebarProvider>
      </TooltipProvider>,
    )
    const link = screen.getByRole('link', { name: /Data Management/i })
    expect(link).toHaveAttribute('href', '/dashboard/data-management')
  })
})
