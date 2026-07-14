import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

describe('App', () => {
  it('renders the accessible workspace placeholder', () => {
    render(<App />)

    expect(screen.getByRole('main', { name: 'Markdown Workbench' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在准备工作区')
  })
})
