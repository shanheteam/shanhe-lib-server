import { Repository } from 'typeorm';
import { User, UserGroup } from '../entities';

/**
 * 用户 JSON 输出。
 * 管理员用户接口与 OAuth/SSO 登录返回体共用；字段与前端 user store 对齐。
 * 此前在 src/modules/user/user.service.ts 与 src/modules/oauth/oauth.service.ts
 * 各存在一份完全相同的私有实现，改动时需要同步两处。
 */
export function buildUserJson(user: User, groupIds: number[] = []): Record<string, unknown> {
  return {
    id: Number(user.id),
    mobile: user.mobile,
    email: user.email,
    address: user.address,
    signature: user.signature,
    last_login_ip: user.last_login_ip,
    register_ip: user.register_ip,
    doc_count: user.doc_count,
    follow_count: user.follow_count,
    fans_count: user.fans_count,
    favorite_count: user.favorite_count,
    comment_count: user.comment_count,
    credit_count: user.credit_count,
    article_count: user.article_count,
    avatar: user.avatar,
    student_id: user.student_id,
    realname: user.realname,
    login_at: user.login_at,
    created_at: user.created_at,
    updated_at: user.updated_at,
    group_id: groupIds,
  };
}

/**
 * 取用户所属的用户组 id 列表（过滤非正数）。
 * 同样原先在 user.service.ts 与 oauth.service.ts 各有一份完全相同的实现。
 */
export async function getUserGroupIds(
  repo: Repository<UserGroup>,
  userId: number,
): Promise<number[]> {
  const rows = await repo.find({ where: { user_id: userId } });
  return rows.map((r) => Number(r.group_id)).filter((id) => id > 0);
}
