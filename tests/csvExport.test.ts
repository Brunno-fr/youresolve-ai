import { describe, expect, it } from 'vitest';
import { serializeCsv } from '../src/domain/csvExport';

describe('exportação CSV', () => {
  it('preserva vírgulas, aspas, quebras e Unicode dentro de uma célula', () => {
    expect(serializeCsv([['ação', 'Uma "nota", com\nquebra'], ['2', 'ok']]))
      .toBe('\uFEFF"ação","Uma ""nota"", com\nquebra"\r\n"2","ok"');
  });

  it.each(['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', '  =HYPERLINK("x")', '\t=2', '\r+2', '\n@x', '\u0000-4', '\u00a0=3'])(
    'neutraliza expressão de planilha %j', value => {
      expect(serializeCsv([[value]])).toBe(`\uFEFF"'${value.replace(/"/g, '""')}"`);
    },
  );

  it('não altera texto comum e neutraliza prefixos de controle', () => {
    expect(serializeCsv([['YS-001', 'Preço = 20', '\ttexto', '']]))
      .toBe('\uFEFF"YS-001","Preço = 20","\'\ttexto",""');
  });
});