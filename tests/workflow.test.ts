import { describe, expect, it } from 'vitest';
import { emptyWorkflow, parseStoredWorkflow, transitionWorkflow } from '../src/domain/workflow';

const known = new Set(['CASE-1']);
const event = { id: 'EV-1', at: '2026-11-25T15:30:00.000Z', actor: 'Analista (demonstração)' };
const note = 'Valores conferidos nas evidências do pedido.';
const resolved = () => transitionWorkflow(emptyWorkflow(), 'CASE-1', 'resolved', note, event)!;

describe('decisões humanas e persistência local', () => {
  it('exige justificativa suficiente, incluindo após remover espaços', () => {
    expect(transitionWorkflow(emptyWorkflow(), 'CASE-1', 'resolved', '   curta   ', event)).toBeNull();
    expect(transitionWorkflow(emptyWorkflow(), 'CASE-1', 'resolved', 'x'.repeat(4001), event)).toBeNull();
  });
  it('registra decisão com estado, ator, nota e timestamp sem alterar o fluxo anterior', () => {
    const initial = emptyWorkflow();
    const next = transitionWorkflow(initial, 'CASE-1', 'resolved', `  ${note}  `, event)!;
    expect(initial.audit).toHaveLength(0);
    expect(next.statuses['CASE-1']).toBe('resolved');
    expect(next.audit[0]).toEqual({ ...event, caseId: 'CASE-1', action: 'Ocorrência resolvida', status: 'resolved', note });
  });
  it('não duplica eventos de transições repetidas e permite reabrir', () => {
    const previous = resolved();
    expect(transitionWorkflow(previous, 'CASE-1', 'resolved', note, event)).toBeNull();
    const reopened = transitionWorkflow(previous, 'CASE-1', 'open', 'Reavaliar evidência recebida.', { ...event, id: 'EV-2' })!;
    expect(reopened.audit).toHaveLength(2);
    expect(reopened.statuses['CASE-1']).toBe('open');
  });
  it.each([null, 'invalid', 'null', '[]', '{"statuses":null,"audit":[]}', '{"statuses":[],"audit":[]}', '{"statuses":{},"audit":null}'])('recupera armazenamento malformado %s', raw => {
    expect(parseStoredWorkflow(raw, known)).toEqual(emptyWorkflow());
  });
  it('restaura histórico válido e normaliza a ação pelo estado explícito', () => {
    const value = resolved();
    value.audit[0].action = 'texto adulterado';
    const result = parseStoredWorkflow(JSON.stringify(value), known);
    expect(result.audit[0].action).toBe('Ocorrência resolvida');
    expect(result.statuses['CASE-1']).toBe('resolved');
  });
  it('aceita o histórico legado usando o nome conhecido da ação', () => {
    const value = resolved();
    delete value.audit[0].status;
    expect(parseStoredWorkflow(JSON.stringify(value), known).audit[0].status).toBe('resolved');
  });
  it('descarta IDs de outro conjunto, datas inválidas, duplicatas e notas ausentes de resolução', () => {
    const value = resolved();
    value.audit.push({ ...value.audit[0] }, { ...value.audit[0], id: 'OTHER', caseId: 'UPLOADED' }, { ...value.audit[0], id: 'BAD-DATE', at: 'invalid' }, { ...value.audit[0], id: 'NO-NOTE', note: '' });
    expect(parseStoredWorkflow(JSON.stringify(value), known).audit).toHaveLength(1);
  });
  it('não restaura estados sem evidências e prioriza a transição mais recente', () => {
    const value = resolved();
    value.statuses['UNKNOWN'] = 'resolved';
    value.audit.push({ ...value.audit[0], id: 'EV-2', status: 'open', at: '2026-11-26T15:30:00.000Z' });
    expect(parseStoredWorkflow(JSON.stringify(value), known).statuses).toEqual({ 'CASE-1': 'open' });
    expect(parseStoredWorkflow('{"statuses":{"CASE-1":"resolved"},"audit":[]}', known).statuses).toEqual({});
  });
  it.each([
    '2026-02-30T15:30:00.000Z',
    '2026-11-25T15:30:00.000',
  ])('descarta timestamp impossível ou sem fuso sem perder o histórico válido: %s', at => {
    const value = resolved();
    value.audit.unshift({
      ...event, id: 'EV-INVALID', caseId: 'CASE-1', action: 'Ocorrência reaberta', status: 'open', at,
    });
    const result = parseStoredWorkflow(JSON.stringify(value), known);
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0].id).toBe('EV-1');
    expect(result.audit[0].at).toBe(event.at);
    expect(result.statuses['CASE-1']).toBe('resolved');
  });
});
