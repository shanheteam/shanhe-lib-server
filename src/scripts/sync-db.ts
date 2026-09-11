import 'reflect-metadata';
import { AppDataSource } from '../database/data-source';
import {
  User,
  Group,
  UserGroup,
  Permission,
  GroupPermission,
  Config,
  Article,
  Friendlink,
  Navigation,
  Language,
} from '../entities';
import {
  PERMISSIONS_SEED,
  CONFIG_SEED,
  GROUPS_SEED,
  FRIENDLINKS_SEED,
  ARTICLES_SEED,
  NAVIGATIONS_SEED,
  LANGUAGES_SEED,
} from '../database/seed-data';
import { makePassword } from '../common/password.util';

const log = (msg: string) => console.log(`[sync-db] ${msg}`);

async function main() {
  log('初始化数据源...');
  await AppDataSource.initialize();
  await AppDataSource.runMigrations(); // 无迁移文件时为空操作

  log('同步表结构（等价 GORM AutoMigrate）...');
  await AppDataSource.synchronize();

  const groupRepo = AppDataSource.getRepository(Group);
  const permissionRepo = AppDataSource.getRepository(Permission);
  const groupPermissionRepo = AppDataSource.getRepository(GroupPermission);
  const userRepo = AppDataSource.getRepository(User);
  const userGroupRepo = AppDataSource.getRepository(UserGroup);
  const configRepo = AppDataSource.getRepository(Config);
  const articleRepo = AppDataSource.getRepository(Article);
  const friendlinkRepo = AppDataSource.getRepository(Friendlink);
  const navigationRepo = AppDataSource.getRepository(Navigation);
  const languageRepo = AppDataSource.getRepository(Language);

  // 1. 用户组
  const groupCount = await groupRepo.count();
  if (groupCount === 0) {
    log('初始化用户组...');
    await groupRepo.save(
      GROUPS_SEED.map((g) => ({ ...g, created_at: new Date(), updated_at: new Date() })),
    );
  }

  // 2. 权限
  log('初始化权限...');
  for (const p of PERMISSIONS_SEED) {
    const exist = await permissionRepo.findOne({ where: { method: p.method, path: p.path } });
    if (!exist) {
      await permissionRepo.save({
        ...p,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);
    } else {
      exist.title = p.title;
      if (!exist.description) exist.description = p.description;
      await permissionRepo.save(exist);
    }
  }
  // 废弃权限清理
  await permissionRepo.delete({ path: '/api.v1.AttachmentAPI/DeleteAttachment' });

  // 3. 管理员账号（ID=1 为 root 用户，拥有全部权限）
  const userCount = await userRepo.count();
  if (userCount === 0) {
    log('初始化管理员账号 admin / mnt.ltd ...');
    const user = await userRepo.save({
      username: 'admin',
      password: makePassword('mnt.ltd'),
      mobile: '',
      email: '',
      address: '',
      signature: '',
      last_login_ip: '',
      register_ip: '',
      avatar: '',
      identity: '',
      realname: '管理员',
      remark: '',
      created_at: new Date(),
      updated_at: new Date(),
    } as any);
    await userGroupRepo.save({ user_id: user.id, group_id: 1 } as any);
    log(`管理员账号创建成功，用户 ID=${user.id}`);
  } else {
    log(`已存在 ${userCount} 个用户，跳过管理员初始化`);
  }

  // 4. 系统配置
  log('初始化系统配置...');
  for (const cfg of CONFIG_SEED) {
    const exist = await configRepo.findOne({
      where: { category: cfg.category, name: cfg.name },
    });
    if (!exist) {
      await configRepo.save({
        category: cfg.category,
        name: cfg.name,
        label: cfg.label || '',
        value: cfg.value,
        placeholder: cfg.placeholder || '',
        input_type: cfg.input_type,
        sort: cfg.sort,
        options: cfg.options || '',
        col_num: cfg.col_num ?? 24,
        is_secret: cfg.is_secret ?? false,
        created_at: new Date(),
        updated_at: new Date(),
      } as any);
    }
  }

  // 5. 文章/单页
  log('初始化文章与单页...');
  for (const a of ARTICLES_SEED) {
    const exist = await articleRepo.findOne({ where: { identifier: a.identifier } });
    if (!exist) {
      await articleRepo.save({
        identifier: a.identifier,
        title: a.title,
        content: a.content,
        user_id: a.user_id,
        status: a.status,
        keywords: '',
        description: '',
        created_at: new Date(),
        updated_at: new Date(),
      } as any);
    }
  }

  // 6. 友情链接
  if ((await friendlinkRepo.count()) === 0) {
    log('初始化友情链接...');
    await friendlinkRepo.save(
      FRIENDLINKS_SEED.map((f) => ({
        ...f,
        description: '',
        sort: 0,
        created_at: new Date(),
        updated_at: new Date(),
      })),
    );
  }

  // 7. 导航
  if ((await navigationRepo.count()) === 0) {
    log('初始化导航栏...');
    await navigationRepo.save(
      NAVIGATIONS_SEED.map((n) => ({
        ...n,
        parent_id: 0,
        description: '',
        created_at: new Date(),
        updated_at: new Date(),
      })),
    );
  }

  // 8. 语言
  if ((await languageRepo.count()) === 0) {
    log('初始化语言...');
    await languageRepo.save(
      LANGUAGES_SEED.map((l) => ({
        ...l,
        total: 0,
        sort: 0,
        created_at: new Date(),
        updated_at: new Date(),
      })),
    );
  }

  log('数据库初始化完成 ✅');
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('[sync-db] 初始化失败：', err);
  process.exit(1);
});