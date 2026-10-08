import { Repository } from 'typeorm';
import { Punishment } from '../entities';

/**
 * 判断用户是否处于指定类型的处罚中（处罚未过期或永久）。
 * 评论 / 附件 / 收藏三个服务原先各有一份逐字相同的私有实现，改动需同步三处。
 * `userId <= 1` 直接放行：id=1 是 root 管理员，不参与处罚。
 */
export async function isUserInPunishing(
  repo: Repository<Punishment>,
  userId: number,
  types: number[],
): Promise<boolean> {
  if (userId <= 1) return false;
  const row = await repo
    .createQueryBuilder('p')
    .where('p.user_id = :userId', { userId })
    .andWhere('p.enable = :enable', { enable: true })
    .andWhere('p.type IN (:...types)', { types })
    .andWhere('(p.end_time IS NULL OR p.end_time > :now)', { now: new Date() })
    .getOne();
  return !!row;
}
