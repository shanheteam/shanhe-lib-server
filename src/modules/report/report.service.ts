import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Document, Report } from '../../entities';
import { Biz } from '../../common/biz.exception';
import {
  defined,
  normalizePageSize,
  orLike,
  toBoolArray,
  toInt,
  toNumberArray,
  toStringValue,
} from '../../common/query.util';

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(Report)
    private readonly repo: Repository<Report>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
  ) {}

  async create(data: any, userId: number): Promise<void> {
    const documentId = toInt(data.document_id, 0);
    if (documentId <= 0) throw Biz.invalidArgument('文档参数不正确');

    const exist = await this.repo.findOne({
      where: { document_id: documentId, user_id: userId },
    });
    if (exist) throw Biz.alreadyExists('您已举报过当前文档');

    const entity = this.repo.create({
      document_id: documentId,
      document_title: data.document_title ?? '',
      user_id: userId,
      username: data.username ?? '',
      reason: data.reason ?? 0,
      status: data.status === undefined ? false : Boolean(data.status),
      remark: data.remark ?? '',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await this.repo.save(entity);
  }

  async update(data: any): Promise<void> {
    const id = toInt(data.id, 0);
    if (id <= 0) throw Biz.invalidArgument('参数不正确');
    const partial = {
      status: data.status === undefined ? undefined : Boolean(data.status),
      remark: data.remark,
    };
    const res = await this.repo.update(id, {
      ...defined(partial as any),
      updated_at: new Date(),
    });
    if (!res.affected) throw Biz.notFound('举报记录不存在');
  }

  async remove(ids: number[]): Promise<void> {
    if (!ids.length) throw Biz.invalidArgument('举报ID不能为空');
    await this.repo.delete(ids);
  }

  async list(query: any): Promise<{ total: number; report: any[] }> {
    const { page, size } = normalizePageSize(query.page, query.size);
    const where: any = {};
    const statuses = toBoolArray(query.status);
    if (statuses.length) where.status = In(statuses);
    const wd = toStringValue(query.wd);

    const [rows, total] = await this.repo.findAndCount({
      where: orLike<Report>(where, ['document_title'], wd),
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });

    const docIds = [...new Set(rows.map((r) => Number(r.document_id)).filter((id) => id > 0))];
    const uuidMap = new Map<number, string>();
    if (docIds.length) {
      const docs = await this.documentRepo.find({ where: { id: docIds as any } });
      for (const d of docs) uuidMap.set(Number(d.id), d.uuid);
    }

    const report = rows.map((r) => ({
      ...r,
      id: Number(r.id),
      user_id: Number(r.user_id),
      document_id: Number(r.document_id),
      document_uuid: uuidMap.get(Number(r.document_id)) ?? '',
    }));

    return { total, report };
  }
}