import * as crypto from 'crypto';

export interface SmsContext {
  mobile: string;
  code: string;
  type: number;
  /** 该服务商分类下的配置 name -> value */
  conf: Record<string, string>;
}

export interface SmsResult {
  ok: boolean;
  response: string;
  error: string;
}

/** 阿里云短信 POP RPC 签名（HMAC-SHA1） */
async function sendAliyun(ctx: SmsContext): Promise<SmsResult> {
  const accessKeyId = ctx.conf.access_key_id;
  const accessKeySecret = ctx.conf.access_key_secret;
  const signName = ctx.conf.sign_name;
  const templateCode = ctx.conf.template_code;
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    return { ok: false, response: '', error: '阿里云短信配置不完整' };
  }

  const params: Record<string, string> = {
    Action: 'SendSms',
    Version: '2017-05-25',
    Format: 'JSON',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    RegionId: 'cn-hangzhou',
    PhoneNumbers: ctx.mobile,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code: ctx.code }),
  };

  const sorted = Object.keys(params).sort();
  const canonical = sorted
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`;
  const signature = crypto
    .createHmac('sha1', accessKeySecret + '&')
    .update(stringToSign)
    .digest('base64');
  const url = `https://dysmsapi.aliyuncs.com/?${canonical}&Signature=${percentEncode(signature)}`;

  const resp = await fetch(url);
  const text = await resp.text();
  let ok = false;
  let error = '';
  try {
    const json = JSON.parse(text);
    ok = json.Code === 'OK';
    if (!ok) error = `${json.Code}: ${json.Message}`;
  } catch {
    error = `阿里云返回非预期内容（HTTP ${resp.status}）`;
  }
  return { ok, response: text.slice(0, 5000), error };
}

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

/**
 * 发送短信验证码。
 * 阿里云已实现标准 RPC 接口；其余服务商待对接（返回失败并记录原因）。
 */
export async function sendSmsByProvider(provider: string, ctx: SmsContext): Promise<SmsResult> {
  switch (provider) {
    case 'smsAliyun':
      return sendAliyun(ctx);
    case 'smsTencent':
    case 'smsBaidu':
    case 'smsHuawei':
    case 'smsHaomas':
      return { ok: false, response: '', error: `${provider} 服务商接口尚未对接，请先使用阿里云短信` };
    default:
      return { ok: false, response: '', error: `未知短信服务商：${provider}` };
  }
}
