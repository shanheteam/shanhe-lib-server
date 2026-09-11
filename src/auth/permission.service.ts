import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission, UserGroup, GroupPermission } from '../entities';

/**
 * RBAC 权限判断：与原版 model.CheckPermissionByUserId 对齐。
 * - 用户 ID == 1 为 root，拥有全部权限；
 * - 否则通过 user_group -> group_permission -> permission(method+path) 判断。
 */
@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepo: Repository<UserGroup>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissionRepo: Repository<GroupPermission>,
  ) {}

  async check(userId: number, grpcMethod: string): Promise<boolean> {
    if (userId <= 0) return false;
    if (userId === 1) return true;

    // 获取权限项（不存在则自动创建，与原版 GetPermissionByMethodPath(createIfNotExist=true) 对齐）
    let permission = await this.permissionRepo.findOne({
      where: { method: 'GRPC', path: grpcMethod },
    });
    if (!permission) {
      permission = await this.permissionRepo.save({
        method: 'GRPC',
        path: grpcMethod,
        title: grpcMethod,
        description: '',
      } as any);
    }

    // 用户所属用户组
    const userGroups = await this.userGroupRepo.find({ where: { user_id: userId } });
    const groupIds = userGroups.map((ug) => ug.group_id).filter((id) => id > 0);
    if (groupIds.length === 0) return false;

    // 用户组是否被授权
    const gp = await this.groupPermissionRepo
      .createQueryBuilder('gp')
      .where('gp.group_id IN (:...groupIds)', { groupIds })
      .andWhere('gp.permission_id = :pid', { pid: permission.id })
      .getOne();

    return !!gp;
  }

  /** 是否为管理员（拥有任意 group_permission 记录，或 ID==1） */
  async isAdmin(userId: number): Promise<boolean> {
    if (userId <= 0) return false;
    if (userId === 1) return true;
    const userGroups = await this.userGroupRepo.find({ where: { user_id: userId } });
    const groupIds = userGroups.map((ug) => ug.group_id).filter((id) => id > 0);
    if (groupIds.length === 0) return false;
    const gp = await this.groupPermissionRepo
      .createQueryBuilder('gp')
      .where('gp.group_id IN (:...groupIds)', { groupIds })
      .getOne();
    return !!gp;
  }
}