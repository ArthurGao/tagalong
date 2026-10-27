import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Swagger names each schema after its class: two DTO classes with one name silently overwrite each other in
// openapi.json, and the frontend's generated types follow the wrong one (seen with PublicMerchantDto in M7).
describe('DTO class names', () => {
  it('are unique across the API', () => {
    const files = (readdirSync(join(import.meta.dirname, 'modules'), { recursive: true }) as string[]).filter((f) => f.endsWith('.dto.ts'));
    const owners = new Map<string, string[]>();
    for (const file of files) {
      for (const [, name] of readFileSync(join(import.meta.dirname, 'modules', file), 'utf8').matchAll(/^export class (\w+)/gm)) {
        owners.set(name, [...(owners.get(name) ?? []), file]);
      }
    }
    expect([...owners].filter(([, where]) => where.length > 1)).toEqual([]);
    expect(owners.size).toBeGreaterThan(20); // the scan found the DTOs
  });
});
