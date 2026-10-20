import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, MoreThanOrEqual, Repository } from 'typeorm';
import { CreditLog, CreditLogType, User } from '../../entities';

/**
 * 积分流水服务：统一处理奖励发放、扣减与流水记录。
 *
 * 有每日次数上限的奖励会锁定用户行后再统计当天流水，
 * 保证并发请求下不会突破配置的次数上限。
 */
@Injectable()
export class CreditService {
  constructor(
    @InjectRepository(CreditLog)
    private readonly logRepo: Repository<CreditLog>,
  ) {}

  private todayStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private async lockUser(manager: EntityManager, userId: number): Promise<User | null> {
    return manager.findOne(User, {
      where: { id: userId },
      select: { id: true, credit_count: true },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async saveLog(
    manager: EntityManager,
    data: {
      user_id: number;
      type: CreditLogType;
      amount: number;
      balance_after: number;
      ref_id: number;
      remark: string;
    },
  ): Promise<void> {
    await manager.save(
      manager.create(CreditLog, {
        ...data,
        created_at: new Date(),
      }),
    );
  }

  /** 在指定事务中发放一笔积分（无每日次数限制）。 */
  async grant(
    manager: EntityManager,
    userId: number,
    type: CreditLogType,
    amount: number,
    remark: string,
    refId = 0,
  ): Promise<number> {
    if (userId <= 0 || amount <= 0) return 0;
    const user = await this.lockUser(manager, userId);
    if (!user) return 0;

    await manager.increment(User, { id: userId }, 'credit_count', amount);
    await this.saveLog(manager, {
      user_id: userId,
      type,
      amount,
      balance_after: (Number(user.credit_count) || 0) + amount,
      ref_id: refId,
      remark,
    });
    return amount;
  }

  /**
   * 发放有每日次数上限的奖励（自带事务）。
   * 返回实际发放的积分，0 表示达到上限或配置为 0。
   */
  async grantDaily(
    userId: number,
    type: CreditLogType,
    amount: number,
    dailyLimit: number,
    remark: string,
    refId = 0,
  ): Promise<number> {
    if (userId <= 0 || amount <= 0 || dailyLimit <= 0) return 0;
    return this.logRepo.manager.transaction((manager) =>
      this.grantDailyInTransaction(manager, userId, type, amount, dailyLimit, remark, refId),
    );
  }

  /** 发放有每日次数上限的奖励（复用调用方事务）。 */
  async grantDailyInTransaction(
    manager: EntityManager,
    userId: number,
    type: CreditLogType,
    amount: number,
    dailyLimit: number,
    remark: string,
    refId = 0,
  ): Promise<number> {
    if (userId <= 0 || amount <= 0 || dailyLimit <= 0) return 0;
    const user = await this.lockUser(manager, userId);
    if (!user) return 0;

    const count = await manager.count(CreditLog, {
      where: {
        user_id: userId,
        type,
        created_at: MoreThanOrEqual(this.todayStart()),
      },
    });
    if (count >= dailyLimit) return 0;

    await manager.increment(User, { id: userId }, 'credit_count', amount);
    await this.saveLog(manager, {
      user_id: userId,
      type,
      amount,
      balance_after: (Number(user.credit_count) || 0) + amount,
      ref_id: refId,
      remark,
    });
    return amount;
  }

  /**
   * 扣除积分（复用调用方事务），余额不足时扣到 0。
   * 返回实际扣除的积分。
   */
  async deduct(
    manager: EntityManager,
    userId: number,
    type: CreditLogType,
    amount: number,
    remark: string,
    refId = 0,
  ): Promise<number> {
    if (userId <= 0 || amount <= 0) return 0;
    const user = await this.lockUser(manager, userId);
    if (!user) return 0;

    const balance = Number(user.credit_count) || 0;
    const actual = Math.min(balance, amount);
    if (actual <= 0) return 0;

    await manager.decrement(User, { id: userId }, 'credit_count', actual);
    await this.saveLog(manager, {
      user_id: userId,
      type,
      amount: -actual,
      balance_after: balance - actual,
      ref_id: refId,
      remark,
    });
    return actual;
  }

  /** 仅记录一条已直接计入余额的流水（用于注册时的初始积分）。 */
  async record(
    userId: number,
    type: CreditLogType,
    amount: number,
    balanceAfter: number,
    remark: string,
    refId = 0,
  ): Promise<void> {
    if (userId <= 0 || amount <= 0) return;
    await this.logRepo.save(
      this.logRepo.create({
        user_id: userId,
        type,
        amount,
        balance_after: balanceAfter,
        ref_id: refId,
        remark,
        created_at: new Date(),
      }),
    );
  }
}
