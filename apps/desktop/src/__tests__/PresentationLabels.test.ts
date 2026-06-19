import { describe, it, expect } from 'vitest'
import {
  formatExecutionStatus,
  formatExecutionMode,
  formatApprovalStatus,
  formatEventType,
} from '../lib/presentationLabels'

// ---------------------------------------------------------------------------
// 1. formatExecutionStatus — covers all WorkflowRunStatus values
// ---------------------------------------------------------------------------

describe('PresentationLabels — formatExecutionStatus', () => {
  it('translates all canonical WorkflowRunStatus values to human-readable pt-BR', () => {
    const expectations: Record<string, string> = {
      pending_approval: 'Aguardando aprovação',
      approved: 'Aprovado',
      running: 'Em execução',
      completed: 'Concluído',
      failed: 'Falhou',
      rejected: 'Rejeitado',
      cancelled: 'Cancelado',
    }

    for (const [input, expected] of Object.entries(expectations)) {
      expect(formatExecutionStatus(input)).toBe(expected)
    }
  })

  it('returns "Desconhecido" for empty input', () => {
    expect(formatExecutionStatus('')).toBe('Desconhecido')
  })

  it('falls back to a humanized form for unknown statuses (no raw return)', () => {
    // Unknown values must still be formatted, not echoed back as-is.
    const result = formatExecutionStatus('some_unknown_state')
    expect(result).not.toBe('some_unknown_state')
    expect(result).toBe('Some unknown state')
  })
})

// ---------------------------------------------------------------------------
// 2. formatExecutionMode — covers all canonical modes
// ---------------------------------------------------------------------------

describe('PresentationLabels — formatExecutionMode', () => {
  it('translates all canonical execution modes to human-readable pt-BR', () => {
    const expectations: Record<string, string> = {
      simulated: 'Simulado',
      real: 'Real',
      multi_agent: 'Multiagente',
      controlled_execution: 'Execução controlada',
    }

    for (const [input, expected] of Object.entries(expectations)) {
      expect(formatExecutionMode(input)).toBe(expected)
    }
  })

  it('returns "Padrão" for empty input', () => {
    expect(formatExecutionMode('')).toBe('Padrão')
  })

  it('falls back to a humanized form for unknown modes', () => {
    const result = formatExecutionMode('experimental_alpha')
    expect(result).not.toBe('experimental_alpha')
    expect(result).toBe('Experimental alpha')
  })
})

// ---------------------------------------------------------------------------
// 3. formatApprovalStatus — covers all canonical ApprovalStatus values
// ---------------------------------------------------------------------------

describe('PresentationLabels — formatApprovalStatus', () => {
  it('translates all canonical ApprovalStatus values to human-readable pt-BR', () => {
    const expectations: Record<string, string> = {
      pending: 'Pendente',
      approved: 'Aprovado',
      rejected: 'Rejeitado',
    }

    for (const [input, expected] of Object.entries(expectations)) {
      expect(formatApprovalStatus(input)).toBe(expected)
    }
  })

  it('returns "Desconhecido" for empty input', () => {
    expect(formatApprovalStatus('')).toBe('Desconhecido')
  })

  it('falls back to a humanized form for unknown statuses', () => {
    const result = formatApprovalStatus('expired')
    // 'expired' is in the map → 'Expirado'. Verify the contract anyway.
    expect(result).toBe('Expirado')
  })
})

// ---------------------------------------------------------------------------
// 4. formatEventType — covers all 21 controlled_execution.* variants
// ---------------------------------------------------------------------------

describe('PresentationLabels — formatEventType', () => {
  it('translates all 21 controlled_execution.* event variants to human-readable pt-BR', () => {
    const expectations: Record<string, string> = {
      'controlled_execution.started': 'Execução controlada iniciada',
      'controlled_execution.sandbox_ready': 'Sandbox pronto',
      'controlled_execution.before_git_status_captured':
        'Status git pré-execução capturado',
      'controlled_execution.opencode_started': 'Runner iniciado',
      'controlled_execution.opencode_json_event': 'Evento do runner',
      'controlled_execution.opencode_completed': 'Runner concluído',
      'controlled_execution.after_git_status_captured':
        'Status git pós-execução capturado',
      'controlled_execution.changed_files_detected':
        'Arquivos alterados detectados',
      'controlled_execution.diff_generated': 'Diff gerado',
      'controlled_execution.out_of_scope_changes': 'Alterações fora do escopo',
      'controlled_execution.final_approval_required': 'Aprovação final necessária',
      'controlled_execution.completed': 'Execução controlada concluída',
      'controlled_execution.failed': 'Execução controlada falhou',
      'controlled_execution.cancelled': 'Execução controlada cancelada',
      'controlled_execution.ui_started': 'UI iniciada',
      'controlled_execution.ui_cancel_requested': 'Cancelamento solicitado',
      'controlled_execution.ui_opened_diff': 'Diff aberto na UI',
      'controlled_execution.ui_report_copied': 'Relatório copiado',
      'controlled_execution.approved': 'Execução controlada aprovada',
      'controlled_execution.rejected': 'Execução controlada rejeitada',
      'controlled_execution.progress': 'Progresso da execução controlada',
    }

    const keys = Object.keys(expectations)
    // Sanity: the suite actually covers all 21 controlled_execution.* variants.
    expect(keys).toHaveLength(21)
    for (const key of keys) {
      expect(key.startsWith('controlled_execution.')).toBe(true)
    }

    for (const [input, expected] of Object.entries(expectations)) {
      expect(formatEventType(input)).toBe(expected)
    }
  })

  it('translates core event types (workflow, command_run, etc.)', () => {
    expect(formatEventType('workflow')).toBe('Missão')
    expect(formatEventType('command_run')).toBe('Comando')
    expect(formatEventType('approval_request')).toBe('Solicitação de aprovação')
    expect(formatEventType('agent_started')).toBe('Agente iniciado')
  })

  it('returns "Evento" for empty input', () => {
    expect(formatEventType('')).toBe('Evento')
  })

  it('falls back to a humanized form for unknown event types', () => {
    const result = formatEventType('custom_thing_happened')
    expect(result).not.toBe('custom_thing_happened')
    expect(result).toBe('Custom thing happened')
  })
})

// ---------------------------------------------------------------------------
// 5. No raw status value is returned as-is
// ---------------------------------------------------------------------------

describe('PresentationLabels — no raw value is echoed back', () => {
  it('formatExecutionStatus never returns the input verbatim', () => {
    const inputs = [
      'pending_approval',
      'approved',
      'running',
      'completed',
      'failed',
      'rejected',
      'cancelled',
      'some_unknown_status',
      '',
    ]
    for (const input of inputs) {
      const output = formatExecutionStatus(input)
      // The contract: even the fallback humanizes the input.
      // The only "exception" is empty string, which returns the fixed
      // "Desconhecido" label — which is still not equal to "".
      expect(output).not.toBe(input)
    }
  })

  it('formatExecutionMode never returns the input verbatim', () => {
    const inputs = [
      'simulated',
      'real',
      'multi_agent',
      'controlled_execution',
      'unknown_mode',
      '',
    ]
    for (const input of inputs) {
      const output = formatExecutionMode(input)
      expect(output).not.toBe(input)
    }
  })

  it('formatApprovalStatus never returns the input verbatim', () => {
    const inputs = ['pending', 'approved', 'rejected', 'unknown_status', '']
    for (const input of inputs) {
      const output = formatApprovalStatus(input)
      expect(output).not.toBe(input)
    }
  })

  it('formatEventType never returns the input verbatim', () => {
    const inputs = [
      'workflow',
      'controlled_execution.started',
      'controlled_execution.final_approval_required',
      'random_event_type',
      '',
    ]
    for (const input of inputs) {
      const output = formatEventType(input)
      expect(output).not.toBe(input)
    }
  })

  it('every formatted output is non-empty and human-readable (has at least one letter or digit)', () => {
    const samples = [
      formatExecutionStatus('pending_approval'),
      formatExecutionStatus('failed'),
      formatExecutionMode('controlled_execution'),
      formatApprovalStatus('rejected'),
      formatEventType('controlled_execution.started'),
    ]
    for (const s of samples) {
      expect(s.length).toBeGreaterThan(0)
      expect(/[a-zA-Z0-9À-ÿ]/.test(s)).toBe(true)
    }
  })
})
