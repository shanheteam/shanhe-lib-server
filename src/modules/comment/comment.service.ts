import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  Article,
  Comment,
  Document,
  Group,
  Punishment,
  User,
  UserGroup,
} from '../../entities';
import { ConfigService } from '../../config/config.service';
import { CaptchaService } from '../captcha/captcha.service';
import { Biz } from '../../common/biz.exception';

// 评论状态（web/utils/enum.js commentStatusOptions）
const COMMENT_STATUS_APPROVED = 1;

// 惩罚类型（model/punishment.go）
const PUNISHMENT_DISABLED = 1;
const PUNISHMENT_COMMENT_LIMITED = 2;

@Injectable()
export class CommentService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    @InjectRepository(Article)
    private readonly articleRepo: Repository<Article>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(Punishment)
    private readonly punishmentRepo: Repository<Punishment>,
    private readonly config: ConfigService,
    private readonly captchaService: CaptchaService,
  ) {}

  private async isInPunishing(userId: number, types: number[]): Promise<boolean> {
    if (userId <= 1) return false;
    const row = await this.punishmentRepo
      .createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere('p.enable = :enable', { enable: true })
      .andWhere('p.type IN (:...types)', { types })
      .andWhere('(p.end_time IS NULL OR p.end_time > :now)', { now: new Date() })
      .getOne();
    return !!row;
  }

  /** 校验用户是否可以评论，否则抛出业务异常。 */
  private async assertCanComment(userId: number): Promise<void> {
    if (userId <= 0) throw Biz.unauthenticated('请先登录');
    if (await this.isInPunishing(userId, [PUNISHMENT_COMMENT_LIMITED, PUNISHMENT_DISABLED])) {
      throw Biz.permissionDenied('您已经被禁止评论');
    }

    const group = await this.groupRepo
      .createQueryBuilder('g')
      .innerJoin(UserGroup, 'ug', 'ug.group_id = g.id')
      .where('ug.user_id = :userId', { userId })
      .andWhere('g.enable_comment = :enable', { enable: true })
      .getOne();
    if (!group) throw Biz.permissionDenied('您所在用户组不允许评论');

    const interval = this.config.getInt('security', 'comment_interval', 0);
    if (interval > 0) {
      const latest = await this.commentRepo.findOne({ where: { user_id: userId }, order: { id: 'DESC' } });
      if (latest && latest.created_at) {
        const seconds = Math.floor((Date.now() - new Date(latest.created_at).getTime()) / 1000);
        const left = interval - seconds;
        if (left > 0) throw Biz.invalidArgument(`您的评论太快了，请等待 ${left} 秒后再试`);
      }
    }
  }

  /** 评论是否需要审核（0 待审，1 过审）。 */
  private async getDefaultCommentStatus(userId: number): Promise<number> {
    const group = await this.groupRepo
      .createQueryBuilder('g')
      .innerJoin(UserGroup, 'ug', 'ug.group_id = g.id')
      .where('ug.user_id = :userId', { userId })
      .andWhere('g.enable_comment_approval = :enable', { enable: false })
      .getOne();
    return group ? COMMENT_STATUS_APPROVED : 0;
  }

  async createComment(userId: number, body: Record<string, any>, ip: string): Promise<void> {
    const documentId = Number(body.document_id) || 0;
    const parentId = Number(body.parent_id) || 0;
    const content = String(body.content ?? '').trim();
    const type = Number(body.type) || 0;

    if (this.config.getBool('security', 'enable_captcha_comment', false)) {
      if (!body.captcha_id || !body.captcha) throw Biz.invalidArgument('请输入验证码');
      if (!this.captchaService.verify(body.captcha_id, body.captcha, true)) {
        throw Biz.invalidArgument('验证码错误');
      }
    }

    await this.assertCanComment(userId);

    if (documentId <= 0) throw Biz.invalidArgument('文档id不能为空');
    if (!content) throw Biz.invalidArgument('评论内容不能为空');

    const status = await this.getDefaultCommentStatus(userId);
    const now = new Date();

    await this.commentRepo.manager.transaction(async (manager: EntityManager) => {
      const entity = manager.create(Comment, {
        user_id: userId,
        parent_id: parentId,
        content,
        document_id: documentId,
        status,
        comment_count: 0,
        ip: ip || '',
        type,
        created_at: now,
        updated_at: now,
      } as Comment);
      await manager.save(entity);

      // 目标（文档/文章）评论数 +1
      if (type === 1) {
        await manager.increment(Article, { id: documentId }, 'comment_count', 1);
      } else {
        await manager.increment(Document, { id: documentId }, 'comment_count', 1);
      }

      // 用户评论数 +1
      await manager.increment(User, { id: userId }, 'comment_count', 1);

      // 回复时，父级评论回复数 +1
      if (parentId > 0) {
        await manager.increment(Comment, { id: parentId }, 'comment_count', 1);
      }
    });
  }

  /** 更新评论（仅限管理员），只允许更新内容和状态。 */
  async updateComment(body: Record<string, any>): Promise<void> {
    const id = Number(body.id) || 0;
    await this.commentRepo.update(
      { id },
      {
        content: String(body.content ?? ''),
        status: Number(body.status) || 0,
        updated_at: new Date(),
      },
    );
  }

  /** 删除评论：管理员删除任意评论；普通用户仅能删除自己的评论。 */
  async deleteComment(ids: number[], userId: number, isAdmin: boolean): Promise<void> {
    if (!ids.length) return;
    const qb = this.commentRepo
      .createQueryBuilder('c')
      .where('c.id IN (:...ids)', { ids });
    if (!isAdmin) qb.andWhere('c.user_id = :userId', { userId });

    const comments = await qb.getMany();
    if (!comments.length) throw Biz.notFound('评论不存在或没有权限删除');

    await this.commentRepo.manager.transaction(async (manager: EntityManager) => {
      await manager.remove(comments);
      for (const comment of comments) {
        if (comment.type === 1) {
          await manager.decrement(Article, { id: comment.document_id }, 'comment_count', 1);
        } else {
          await manager.decrement(Document, { id: comment.document_id }, 'comment_count', 1);
        }
        if (comment.parent_id > 0) {
          await manager.decrement(Comment, { id: comment.parent_id }, 'comment_count', 1);
        }
        await manager.decrement(User, { id: comment.user_id }, 'comment_count', 1);
      }
    });
  }

  async checkComment(ids: number[], status: number): Promise<void> {
    if (!ids.length) return;
    await this.commentRepo
      .createQueryBuilder()
      .update(Comment)
      .set({ status, updated_at: new Date() })
      .where('id IN (:...ids) AND status != :status', { ids, status })
      .execute();
  }

  async getComment(id: number): Promise<Record<string, unknown>> {
    const comment = await this.commentRepo.findOne({ where: { id } });
    if (!comment) throw Biz.notFound('评论不存在');
    return (await this.enrich([comment]))[0];
  }

  async listComment(
    query: Record<string, any>,
    userId: number,
    isAdmin: boolean,
  ): Promise<{ total: number; comment: Record<string, unknown>[] }> {
    const documentId = Number(query.document_id) || 0;
    let page = Number(query.page) || 1;
    let size = Number(query.size) || 10;
    if (documentId > 0) {
      // 文档详情页拉取该文档全部评论
      page = 1;
      size = 100000;
    }
    page = Math.max(1, page);
    size = Math.max(1, Math.min(size, 100000));

    const qb = this.commentRepo.createQueryBuilder('c');

    // 默认只返回已审核评论；管理员或查看自己列表时可放宽
    const selfQuery = userId > 0 && Number(query.user_id) === userId;
    if (isAdmin || selfQuery) {
      const statuses = toNumberArray(query.status);
      qb.where('c.status IN (:...status)', { status: statuses.length ? statuses : [0, 1, 2] });
    } else {
      qb.where('c.status = :status', { status: COMMENT_STATUS_APPROVED });
    }

    if (documentId > 0) qb.andWhere('c.document_id = :documentId', { documentId });

    const types = toNumberArray(query.type);
    if (types.length) qb.andWhere('c.type IN (:...types)', { types });

    const parentIds = toNumberArray(query.parent_id);
    if (parentIds.length) qb.andWhere('c.parent_id IN (:...parentIds)', { parentIds });

    if (isAdmin && String(query.wd ?? '').trim()) {
      qb.andWhere('c.content LIKE :wd', { wd: `%${String(query.wd).trim()}%` });
    }

    const userIds = toNumberArray(query.user_id);
    if (userIds.length) qb.andWhere('c.user_id IN (:...userIds)', { userIds });

    const total = await qb.getCount();
    const list = await qb
      .orderBy('c.id', 'DESC')
      .offset((page - 1) * size)
      .limit(size)
      .getMany();

    const withTitle = query.with_document_title === true ||
      query.with_document_title === 'true' ||
      query.with_document_title === '1';

    return { total, comment: await this.enrich(list, withTitle) };
  }

  // ---------- 序列化 ----------

  private async enrich(
    comments: Comment[],
    withTitle = true,
  ): Promise<Record<string, unknown>[]> {
    const comment = comments[0];
    if (!comment) return [];

    const userIds = [...new Set(comments.map((c) => c.user_id).filter((id) => id > 0))];
    const users = userIds.length
      ? await this.userRepo.find({ where: { id: userIds as any } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const docIds = comments.filter((c) => c.type !== 1).map((c) => c.document_id).filter((id) => id > 0);
    const articleIds = comments.filter((c) => c.type === 1).map((c) => c.document_id).filter((id) => id > 0);

    const titleMap = new Map<number, { title: string; uuid: string }>();
    if (withTitle) {
      if (docIds.length) {
        const docs = await this.documentRepo.find({ where: { id: [...new Set(docIds)] as any } });
        for (const d of docs) titleMap.set(Number(d.id), { title: d.title, uuid: d.uuid });
      }
      if (articleIds.length) {
        const articles = await this.articleRepo.find({ where: { id: [...new Set(articleIds)] as any } });
        for (const a of articles) titleMap.set(Number(a.id), { title: a.title, uuid: a.identifier });
      }
    }

    return comments.map((c) => {
      const user = userMap.get(c.user_id);
      const t = titleMap.get(Number(c.document_id));
      return {
        id: Number(c.id),
        parent_id: Number(c.parent_id),
        content: c.content,
        document_id: Number(c.document_id),
        status: c.status,
        comment_count: c.comment_count,
        user_id: Number(c.user_id),
        type: c.type,
        ip: c.ip,
        created_at: c.created_at,
        updated_at: c.updated_at,
        user: user
          ? {
              id: Number(user.id),
              avatar: user.avatar,
              realname: user.realname,
              identity: user.identity,
            }
          : null,
        document_title: t?.title ?? '',
        document_uuid: t?.uuid ?? '',
      };
    });
  }
}

function toNumberArray(v: unknown): number[] {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((n) => Number(n)).filter((n) => !Number.isNaN(n));
}