import 'dotenv/config';

export interface EnvConfig {
  port: number;
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    prefix: string;
  };
  jwt: {
    secret: string;
    expireDays: number;
  };
  uploadDir: string;
  documentDir: string;
  corsOrigin: string;
}

export const env: EnvConfig = {
  port: parseInt(process.env.PORT || '8880', 10),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_DATABASE || 'moredoc',
    prefix: process.env.DB_PREFIX || 'mnt_',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'moredoc',
    expireDays: parseInt(process.env.JWT_EXPIRE_DAYS || '3650', 10),
  },
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  documentDir: process.env.DOCUMENT_DIR || 'documents',
  corsOrigin: process.env.CORS_ORIGIN || '',
};