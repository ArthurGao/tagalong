import type { FormField } from '../listings/form-fields.js';
import type { MerchantOrderDto } from './merchant-order.dto.js';

const decimal = (cents: number) => (cents / 100).toFixed(2);
const answer = (v: unknown) => (Array.isArray(v) ? v.join('; ') : v === undefined || v === null ? '' : String(v));

/** A spreadsheet-safe cell (RFC 4180 quoting; a leading = + - @ is neutralised against formula injection). */
export function csvCell(value: unknown): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The merchant's orders as CSV, with a column per custom field. UTF-8 with a BOM so Excel reads Chinese names. */
export function ordersCsv(fields: FormField[], orders: MerchantOrderDto[]): string {
  const columns: [string, (o: MerchantOrderDto) => unknown][] = [
    ['#', (o) => o.sequenceNo ?? ''],
    ['Order', (o) => o.publicCode],
    ['Status', (o) => o.status],
    ['Name', (o) => o.buyerName],
    ['Email', (o) => o.buyerEmail],
    ['Phone', (o) => o.buyerPhone],
    ['Items', (o) => o.items.map((i) => `${i.name} x${i.quantity}`).join('; ')],
    ['Total', (o) => decimal(o.totalCents)],
    ['Refunded', (o) => decimal(o.refundedCents)],
    ['Pickup', (o) => o.pickupPointLabel ?? ''],
    ['Note', (o) => o.buyerNote ?? ''],
    ['Time', (o) => (o.paidAt ?? o.createdAt).toISOString()],
    ...fields
      .filter((f) => f.scope === 'order')
      .map((f): [string, (o: MerchantOrderDto) => unknown] => [f.label, (o) => answer(o.formAnswers[f.key])]),
    ...fields
      .filter((f) => f.scope === 'attendee')
      .map((f): [string, (o: MerchantOrderDto) => unknown] => [
        `${f.label} (each place)`,
        (o) => o.items.flatMap((i) => i.attendeeAnswers.map((a) => answer(a[f.key]))).join(' | '),
      ]),
  ];
  const lines = [columns.map(([label]) => label), ...orders.map((o) => columns.map(([, value]) => value(o)))];
  return '﻿' + lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
