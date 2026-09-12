import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Config } from '../../entities';
import { RequirePermission } from '../../common/decorators/permission.decorator';
import { Biz } from '../../common/biz.exception';

interface WechatpayConf {
  mchid: string;
  serialNo: string;
  privateKey: string;
  apiV3Key: string;
  enableSandbox: boolean;
}

/**
 * 微信支付配置辅助：通过商户 API 私钥拉取并解密微信支付平台证书。
 * 对应专业版后台【微信支付配置】页的「获取平台证书」按钮。
 */
@Controller('wechatpay')
export class WechatpayController {
  constructor(
    @InjectRepository(Config)
    private readonly configRepo: Repository<Config>,
  ) {}

  @Get('cert')
  @RequirePermission('/api.v1.ConfigAPI/UpdateConfig')
  async fetchCert() {
    const conf = await this.loadConf();
    if (!conf.mchid || !conf.serialNo || !conf.privateKey || !conf.apiV3Key) {
      throw Biz.invalidArgument('请先完整填写商户号、证书序列号、API私钥和APIv3密钥');
    }
    if (!/^[0-9a-fA-F]{32}$/.test(conf.apiV3Key)) {
      throw Biz.invalidArgument('APIv3密钥应为32位字符');
    }

    const host = conf.enableSandbox ? 'api.mch.weixin.qq.com' : 'api.mch.weixin.qq.com';
    const path = '/v3/certificates';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const message = `GET\n${path}\n${timestamp}\n${nonce}\n\n`;
    let signature: string;
    try {
      signature = crypto
        .createSign('RSA-SHA256')
        .update(message)
        .sign(this.normalizePrivateKey(conf.privateKey), 'base64');
    } catch {
      throw Biz.invalidArgument('API私钥格式不正确，请粘贴 apiclient_key.pem 的完整内容');
    }

    const authorization =
      `WECHATPAY2-SHA256-RSA2048 mchid="${conf.mchid}",` +
      `nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${conf.serialNo}",signature="${signature}"`;

    let payload: any;
    try {
      const resp = await fetch(`https://${host}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: authorization, 'User-Agent': 'moredoc' },
      });
      payload = await resp.json();
      if (!resp.ok || !Array.isArray(payload.data)) {
        throw new Error(payload?.message || `HTTP ${resp.status}`);
      }
    } catch (e) {
      throw Biz.internal(`拉取平台证书失败：${(e as Error).message}`);
    }

    // 选取最新一张证书（微信返回按启用时间排序）
    const certItem = payload.data[payload.data.length - 1];
    const resource = certItem?.encrypt_certificate;
    if (!resource?.ciphertext) throw Biz.internal('微信返回数据中缺少证书内容');

    let pem: string;
    try {
      pem = this.decryptResource(
        resource.ciphertext,
        resource.nonce,
        resource.associated_data || '',
        conf.apiV3Key,
      );
    } catch (e) {
      throw Biz.internal(`平台证书解密失败，请检查APIv3密钥：${(e as Error).message}`);
    }
    if (!pem.includes('BEGIN CERTIFICATE')) {
      throw Biz.internal('解密结果不是合法证书');
    }

    // 专业版仅回传证书内容，由前端回填到表单后随「保存设置」一并落库
    return {
      cert: pem,
      serial_no: certItem.serial_no,
      effective_time: certItem.effective_time,
      expire_time: certItem.expire_time,
    };
  }

  private async loadConf(): Promise<WechatpayConf> {
    const get = async (name: string, fallback = '') => {
      const row = await this.configRepo.findOne({ where: { category: 'wechatpay', name } });
      return row?.value ?? fallback;
    };
    return {
      mchid: (await get('mchid')).trim(),
      serialNo: (await get('serial_no')).trim(),
      privateKey: await get('private_key'),
      apiV3Key: (await get('api_v3_key')).trim(),
      enableSandbox: (await get('enable_sandbox')) === 'true',
    };
  }

  /** 兼容粘贴时丢失 PEM 头尾/换行的私钥 */
  private normalizePrivateKey(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.includes('BEGIN PRIVATE KEY') || trimmed.includes('BEGIN RSA PRIVATE KEY')) return trimmed;
    const body64 = trimmed.replace(/\s+/g, '');
    return `-----BEGIN PRIVATE KEY-----\n${body64.match(/.{1,64}/g)?.join('\n') ?? body64}\n-----END PRIVATE KEY-----`;
  }

  /** 微信支付 APIv3 回包解密：AES-256-GCM，密文末尾16字节为 authTag */
  private decryptResource(ciphertext: string, nonce: string, associatedData: string, apiV3Key: string): string {
    const cipherBuf = Buffer.from(ciphertext, 'base64');
    const authTag = cipherBuf.subarray(cipherBuf.length - 16);
    const data = cipherBuf.subarray(0, cipherBuf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
    decipher.setAuthTag(authTag);
    if (associatedData) decipher.setAAD(Buffer.from(associatedData));
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
