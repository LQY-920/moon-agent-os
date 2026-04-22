import argon2 from 'argon2';
import { zxcvbnAsync, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';
import { WeakPasswordError } from '../domain/errors';

zxcvbnOptions.setOptions({
  dictionary: {
    ...zxcvbnCommon.dictionary,
    ...zxcvbnEn.dictionary,
  },
  graphs: zxcvbnCommon.adjacencyGraphs,
  translations: zxcvbnEn.translations,
});

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  checkStrength(plain: string): void {
    const details: Record<string, string> = {};
    if (plain.length < 12) {
      details.password = '密码至少 12 位';
      throw new WeakPasswordError(details);
    }
    // zxcvbn 同步一个简单子集:检查是否在前 10K 常见字典
    // 实际生产我们用 zxcvbnAsync,但同步版由 length + 简单启发足够 M0
    const common = ['password', 'password1', '12345678', 'qwertyuiop', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'abc12345'];
    const lower = plain.toLowerCase();
    if (common.some((c) => lower.includes(c))) {
      details.password = '密码过于常见,请使用更强的组合';
      throw new WeakPasswordError(details);
    }
  }

  async checkStrengthAsync(plain: string): Promise<void> {
    this.checkStrength(plain);
    const result = await zxcvbnAsync(plain);
    if (result.score < 2) {
      throw new WeakPasswordError({ password: '密码强度过低(zxcvbn score < 2)' });
    }
  }
}
