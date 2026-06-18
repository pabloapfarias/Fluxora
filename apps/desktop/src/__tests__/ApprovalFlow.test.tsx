// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PendingApprovalsPanel } from '../components/right-panel/PendingApprovalsPanel'
import type { Approval } from '@fluxora/shared'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseApproval: Approval = {
  id: 'ap-1',
  title: 'Aprovar cupom de primeira compra',
  description: [
    'Missão: Implementar cupom de primeira compra',
    'Motivo: Foram detectadas alterações em arquivos.',
    '',
    'Arquivos alterados:',
    '- app/Http/Controllers/CouponController.php (modified, +15/-3)',
    '- database/migrations/2026_06_15_create_coupons.php (added, +25/-0)',
    '- routes/api.php (modified, +2/-0)',
    '',
    'Resumo: +42/-3 linhas em 3 arquivo(s)',
    'Impacto: Médio',
    'Agente: OpenCode CLI (modo real)',
  ].join('\n'),
  impact: 'medium',
  status: 'pending',
  projectId: 'proj-1',
  workflowRunId: 'wr-1',
  createdAt: new Date().toISOString(),
  resolvedAt: undefined,
}

const renderPanel = (
  approvals: Approval[],
  callbacks: {
    onApprove?: (id: string) => void
    onReject?: (id: string) => void
    onViewAll?: () => void
  } = {},
) => {
  const onApprove = callbacks.onApprove ?? vi.fn()
  const onReject = callbacks.onReject ?? vi.fn()
  const onViewAll = callbacks.onViewAll ?? vi.fn()
  const utils = render(
    <MemoryRouter>
      <PendingApprovalsPanel
        approvals={approvals}
        onApprove={onApprove}
        onReject={onReject}
        onViewAll={onViewAll}
      />
    </MemoryRouter>,
  )
  return { ...utils, onApprove, onReject, onViewAll }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Auto-cleanup the DOM between tests — vitest 1.6 + RTL 16 do not enable
// the global afterEach hook by default in this repo, so we wire it manually.
afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// 1. Empty state — "Tudo em dia"
// ---------------------------------------------------------------------------

describe('ApprovalFlow — empty state', () => {
  it('shows "Tudo em dia" when there are no pending approvals', () => {
    renderPanel([])
    expect(screen.getByText('Tudo em dia')).toBeTruthy()
    expect(screen.getByText('Nenhuma aprovação pendente')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 2. Header reflects the correct count
// ---------------------------------------------------------------------------

describe('ApprovalFlow — header count', () => {
  it('shows "Aprovações pendentes: N" with the correct count for 1 approval', () => {
    renderPanel([baseApproval])
    // The header text is "Aprovações pendentes: N" — match it dynamically.
    expect(screen.getByText(/Aprovações pendentes:\s*1/)).toBeTruthy()
  })

  it('shows "Aprovações pendentes: N" with the correct count for multiple approvals', () => {
    renderPanel([
      { ...baseApproval, id: 'ap-1', title: 'A' },
      { ...baseApproval, id: 'ap-2', title: 'B' },
      { ...baseApproval, id: 'ap-3', title: 'C' },
    ])
    expect(screen.getByText(/Aprovações pendentes:\s*3/)).toBeTruthy()
  })

  it('does NOT show "Tudo em dia" when there are pending approvals', () => {
    renderPanel([baseApproval])
    expect(screen.queryByText('Tudo em dia')).toBeNull()
    expect(screen.queryByText('Nenhuma aprovação pendente')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. Per-approval action buttons
// ---------------------------------------------------------------------------

describe('ApprovalFlow — action buttons', () => {
  it('shows an "Aprovar" button for each pending approval', () => {
    renderPanel([
      { ...baseApproval, id: 'ap-1', title: 'Primeira' },
      { ...baseApproval, id: 'ap-2', title: 'Segunda' },
    ])
    // The panel renders one Aprovar button per approval with an aria-label
    // "Aprovar: <title>". The visible text on the button is just "Aprovar".
    expect(
      screen.getByRole('button', { name: /Aprovar: Primeira/i }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Aprovar: Segunda/i }),
    ).toBeTruthy()
  })

  it('shows a "Rejeitar" button for each pending approval', () => {
    renderPanel([
      { ...baseApproval, id: 'ap-1', title: 'Primeira' },
      { ...baseApproval, id: 'ap-2', title: 'Segunda' },
    ])
    expect(
      screen.getByRole('button', { name: /Rejeitar: Primeira/i }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Rejeitar: Segunda/i }),
    ).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 4. Click handlers — onApprove / onReject wired correctly
// ---------------------------------------------------------------------------

describe('ApprovalFlow — click wiring', () => {
  it('calls onApprove with the correct approval id when "Aprovar" is clicked', () => {
    const onApprove = vi.fn()
    renderPanel(
      [{ ...baseApproval, id: 'ap-42', title: 'Aprovar 42' }],
      { onApprove },
    )
    fireEvent.click(screen.getByRole('button', { name: /Aprovar: Aprovar 42/i }))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onApprove).toHaveBeenCalledWith('ap-42')
  })

  it('calls onReject with the correct approval id when "Rejeitar" is clicked', () => {
    const onReject = vi.fn()
    renderPanel(
      [{ ...baseApproval, id: 'ap-99', title: 'Rejeitar 99' }],
      { onReject },
    )
    fireEvent.click(screen.getByRole('button', { name: /Rejeitar: Rejeitar 99/i }))
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith('ap-99')
  })
})
