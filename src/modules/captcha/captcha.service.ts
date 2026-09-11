import { Injectable } from '@nestjs/common';
import * as svgCaptcha from 'svg-captcha';
import { randomBytes } from 'crypto';

interface CaptchaEntry {
  value: string;
  expireAt: number;
}

/**
 * 图形验证码服务：生成 base64 SVG 验证码并在内存中缓存，供注册/登录/评论等场景校验。
 * 与原版 util/captcha（base64Captcha）行为对齐，返回 { id, captcha }。
 */
@Injectable()
export class CaptchaService {
  private readonly store = new Map<string, CaptchaEntry>();
  private readonly ttl = 10 * 60 * 1000; // 10 分钟

  generate(type = 'digit', length = 4, width = 240, height = 60): { id: string; captcha: string } {
    let text = '';
    let svg = '';
    if (type === 'math') {
      const r = svgCaptcha.createMathExpr({
        width,
        height,
        fontSize: Math.max(24, Math.floor(height / 2)),
        noise: 1,
        background: '#f0f2f5',
      });
      text = r.text;
      svg = r.data;
    } else if (type === 'string') {
      const r = svgCaptcha.create({
        width,
        height,
        size: length || 4,
        noise: 2,
        background: '#f0f2f5',
        charPreset: '1234567890qwertyuioplkjhgfdsazxcvbnm',
        ignoreChars: '0o1il',
      });
      text = r.text;
      svg = r.data;
    } else {
      // digit 数字
      const r = svgCaptcha.create({
        width,
        height,
        size: length || 4,
        noise: 2,
        background: '#f0f2f5',
        charPreset: '1234567890',
        ignoreChars: '01',
      });
      text = r.text;
      svg = r.data;
    }

    const id = randomBytes(16).toString('hex');
    this.store.set(id, { value: text.toLowerCase(), expireAt: Date.now() + this.ttl });
    // 清理过期项
    for (const [k, v] of this.store) {
      if (v.expireAt < Date.now()) this.store.delete(k);
    }
    const b64 = Buffer.from(svg).toString('base64');
    return { id, captcha: `data:image/svg+xml;base64,${b64}` };
  }

  verify(id: string, value: string, clear = true): boolean {
    const entry = this.store.get(id);
    if (!entry) return false;
    if (entry.expireAt < Date.now()) {
      this.store.delete(id);
      return false;
    }
    const ok = entry.value === String(value || '').trim().toLowerCase();
    if (clear) this.store.delete(id);
    return ok;
  }
}