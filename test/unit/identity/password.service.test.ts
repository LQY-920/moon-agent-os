import { describe, it, expect } from 'vitest';
import { PasswordService } from '../../../src/modules/identity/services/password.service';

const svc = new PasswordService();

describe('PasswordService', () => {
  it('hash then verify success', async () => {
    const hash = await svc.hash('CorrectHorseBatteryStaple');
    expect(hash).toMatch(/^\$argon2id\$/);
    const ok = await svc.verify(hash, 'CorrectHorseBatteryStaple');
    expect(ok).toBe(true);
  });

  it('verify wrong password returns false', async () => {
    const hash = await svc.hash('CorrectHorseBatteryStaple');
    const ok = await svc.verify(hash, 'wrong-password-xxxx');
    expect(ok).toBe(false);
  });

  it('checkStrength rejects short password', () => {
    expect(() => svc.checkStrength('short')).toThrow();
  });

  it('checkStrength rejects dictionary weak password', () => {
    expect(() => svc.checkStrength('password1234')).toThrow();
  });

  it('checkStrength accepts strong password', () => {
    expect(() => svc.checkStrength('CorrectHorseBatteryStaple9!')).not.toThrow();
  });
});
