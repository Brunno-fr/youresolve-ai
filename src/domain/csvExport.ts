/**
 * Serializa células em CSV UTF-8 com BOM, aspas e quebras CRLF.
 * @param rows Linhas de texto; valores financeiros devem chegar já formatados.
 * @returns CSV pronto para download local.
 * @remarks Neutraliza fórmulas, inclusive após espaços e caracteres de controle.
 * A proteção é textual e não substitui a revisão de dados ao abrir uma planilha.
 */
export function serializeCsv(rows: readonly (readonly string[])[]): string {
  return '\uFEFF' + rows.map(row => row.map(value => {
    const formula = /^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(value);
    const controlPrefix = /^[\t\r\n]/u.test(value);
    const safe = formula || controlPrefix ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
}