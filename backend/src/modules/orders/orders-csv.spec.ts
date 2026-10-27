import type { MerchantOrderDto } from './merchant-order.dto.js';
import { csvCell, ordersCsv } from './orders-csv.js';

describe('orders CSV', () => {
  it('quotes what needs quoting and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('writes a BOM, a header with the custom fields, and one row per order', () => {
    const order = {
      sequenceNo: 3, publicCode: 'TA-1', status: 'PAID', buyerName: '林小雨', buyerEmail: 'a@example.test', buyerPhone: '021',
      items: [{ name: '2kg', quantity: 2, unitPriceCents: 3900, attendeeAnswers: [{ age: 7 }, { age: 9 }] }],
      totalCents: 7800, refundedCents: 0, pickupPointLabel: 'Albany', buyerNote: null, formAnswers: { size: 'M' },
      paidAt: new Date('2026-10-28T00:00:00Z'), createdAt: new Date('2026-10-27T00:00:00Z'),
    } as unknown as MerchantOrderDto;
    const csv = ordersCsv(
      [
        { key: 'size', label: 'Size', type: 'select', required: true, scope: 'order', options: ['M'] },
        { key: 'age', label: 'Age', type: 'number', required: true, scope: 'attendee' },
      ],
      [order],
    );
    expect(csv.split('\r\n')).toEqual([
      '﻿#,Order,Status,Name,Email,Phone,Items,Total,Refunded,Pickup,Note,Time,Size,Age (each place)',
      '3,TA-1,PAID,林小雨,a@example.test,021,2kg x2,78.00,0.00,Albany,,2026-10-28T00:00:00.000Z,M,7 | 9',
      '',
    ]);
  });
});
