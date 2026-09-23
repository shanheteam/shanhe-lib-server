import { createVerify } from 'node:crypto';

/**
 * 校验 OIDC id_token（RS256，无第三方依赖）。
 * 步骤：分割三段 → 按 kid 取 JWKS 公钥(SPKI PEM) → crypto.verify 验签 → 校验 iss/aud/exp/iat/sub/nonce。
 * 校验失败抛 Error，不再静默回退（OIDC 拒绝脆弱登录）。
 *
 * @param idToken  原始 id_token（header.payload.signature）
 * @param expectedAud      期望 aud（= RP 的 client_id）
 * @param expectedIssuer   期望 iss（= 配置的 issuer，与 Provider discovery 一致）
 * @param expectedNonce    期望 nonce（来自前端，authorize 阶段生成；可选）
 * @param getPublicKey     按 kid 取 PEM 公钥的回调（来自 JwksService）
 * @returns 解出的 payload（含 sub）
 */
export async function verifyIdToken(
  idToken: string,
  expectedAud: string,
  expectedIssuer: string,
  getPublicKey: (kid?: string) => Promise<string | undefined>,
  expectedNonce?: string,
): Promise<Record<string, unknown>> {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) {
    throw new Error('id_token 格式非法（非三段 JWT）');
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header: Record<string, any>;
  let payload: Record<string, any>;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (e) {
    throw new Error('id_token 解码失败');
  }

  if (header.alg !== 'RS256') {
    throw new Error('id_token 算法非 RS256: ' + (header.alg || '(none)'));
  }

  // 按 kid 取公钥并验签（被签串是 header.payload，非整段 token）
  const pem = await getPublicKey(header.kid);
  if (!pem) {
    throw new Error('id_token 校验失败：未取得匹配公钥 kid=' + (header.kid || '(empty)'));
  }
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(sigB64, 'base64url');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  if (!verifier.verify(pem, signature)) {
    throw new Error('id_token 签名校验失败');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || now >= payload.exp) {
    throw new Error('id_token 已过期');
  }
  if (typeof payload.iat === 'number' && payload.iat > now + 60) {
    throw new Error('id_token iat 异常（未来时间）');
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error('id_token issuer 不匹配');
  }
  // aud 可为字符串或字符串数组，均需包含期望 aud
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(expectedAud)) {
    throw new Error('id_token audience 不匹配');
  }
  if (!payload.sub) {
    throw new Error('id_token 缺少 sub');
  }
  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error('id_token nonce 校验失败');
  }

  return payload;
}