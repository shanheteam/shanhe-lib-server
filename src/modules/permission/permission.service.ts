import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '../../entities';
import { Biz } from '../../common/biz.exception';

export interface PermissionInput {
  id?: number;
  title?: string;
  description?: string;
  method?: string;
  path?: string;
}

export interface ListPermissionQuery {
  page?: number;
  size?: number;
  wd?: string;
  method?: string[];
  path?: string;
}

@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
  ) {}

  async updatePermission(input: PermissionInput): Promise<Record<string, never>> {
    if (!input.id) throw Biz.invalidArgument('权限ID不能为空');

    await this.permissionRepo.update(input.id, {
      title: input.title ?? '',
      description: input.description ?? '',
      updated_at: new Date(),
    });

    return {};
  }

  async getPermission(id: number): Promise<Partial<Permission>> {
    if (!id) throw Biz.invalidArgument('权限ID不能为空');
    const permission = await this.permissionRepo.findOne({ where: { id } });
    return permission ?? {};
  }

  async listPermission(
    query: ListPermissionQuery,
  ): Promise<{ total: number; permission: Permission[] }> {
    const { page = 0, size = 0, wd = '', method = [], path = '' } = query;

    const qb = this.permissionRepo.createQueryBuilder('p');
    if (wd) {
      qb.andWhere('(p.title LIKE :wd OR p.description LIKE :wd)', {
        wd: `%${wd}%`,
      });
    }
    if (path) {
      qb.andWhere('p.path LIKE :path', { path: `%${path}%` });
    }
    if (method.length > 0) {
      qb.andWhere('p.method IN (:...method)', { method });
    }

    const total = await qb.getCount();

    qb.orderBy('p.path', 'ASC');
    if (page > 0 && size > 0) {
      qb.offset((page - 1) * size).limit(size);
    }

    const permission = await qb.getMany();
    return { total, permission };
  }
}