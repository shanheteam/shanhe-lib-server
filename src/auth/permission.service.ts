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
  /** 权限项缓存：permission 表基本是静态数据，缓存在鉴权热路径上避免反复查库/写库 */
  private readonly permissionCache = new Map<string, Permission>();
  /** 同一权限项并发首次访问时合并为一次查询，避免并发插入重复记录 */
  private readonly permissionPending = new Map<string, Promise<Permission>>();

  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(GroupPermission)
    private readonly groupPermissionRepo: Repository<GroupPermission>,
  ) {}

  private async getPermission(method: string, path: string): Promise<Permission> {
    const key = `${method}|${path}`;
    const cached = this.permissionCache.get(key);
    if (cached) return cached;

    const pending = this.permissionPending.get(key);
    if (pending) return pending;

    const task = (async () => {
      let permission = await this.permissionRepo.findOne({ where: { method, path } });
      if (!permission) {
        // 与原版 GetPermissionByMethodPath(createIfNotExist=true) 对齐：不存在则自动创建
        permission = await this.permissionRepo.save({
          method,
          path,
          title: path,
          description: '',
        } as any);
      }
      this.permissionCache.set(key, permission);
      return permission;
    })();

    this.permissionPending.set(key, task);
    try {
      return await task;
    } finally {
      this.permissionPending.delete(key);
    }
  }

  async check(userId: number, grpcMethod: string): Promise<boolean> {
    if (userId <= 0) return false;
    if (userId === 1) return true;

    const permission = await this.getPermission('GRPC', grpcMethod);

    // 用户组是否被授权：user_group 与 group_permission 用一次 JOIN 查询完成
    const gp = await this.groupPermissionRepo
      .createQueryBuilder('gp')
      .innerJoin(UserGroup, 'ug', 'ug.group_id = gp.group_id')
      .where('ug.user_id = :userId', { userId })
      .andWhere('ug.group_id > 0')
      .andWhere('gp.permission_id = :pid', { pid: permission.id })
      .getOne();

    return !!gp;
  }

  /** 是否为管理员（拥有任意 group_permission 记录，或 ID==1） */
  async isAdmin(userId: number): Promise<boolean> {
    if (userId <= 0) return false;
    if (userId === 1) return true;

    const gp = await this.groupPermissionRepo
      .createQueryBuilder('gp')
      .innerJoin(UserGroup, 'ug', 'ug.group_id = gp.group_id')
      .where('ug.user_id = :userId', { userId })
      .andWhere('ug.group_id > 0')
      .getOne();

    return !!gp;
  }
}