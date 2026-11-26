/** Formata valores sem recorrer a ponto flutuante para armazenamento. */
export const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export const integer = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
export const percent = (value: number, digits = 1) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)}%`;
export const dateLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
