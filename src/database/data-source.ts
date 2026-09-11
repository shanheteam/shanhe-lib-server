import { DataSource, DataSourceOptions } from 'typeorm';
import { env } from '../config/env';
import { entities } from '../entities';
import { MoredocNamingStrategy } from './naming-strategy';

export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  host: env.db.host,
  port: env.db.port,
  username: env.db.username,
  password: env.db.password,
  database: env.db.database,
  charset: 'utf8mb4',
  timezone: 'local',
  entities,
  namingStrategy: new MoredocNamingStrategy(),
  synchronize: false,
  logging: false,
};

export const AppDataSource = new DataSource(dataSourceOptions);