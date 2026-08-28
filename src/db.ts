import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

export const DEFAULT_DB_PATH = join(__dirname, '..', 'logistics.db');
export const SCHEMA_PATH = join(__dirname, '..', 'schema.sql');

export type Db = Database.Database;

export const openDatabase = (dbPath: string = DEFAULT_DB_PATH): Db => {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
};

export const applySchema = (db: Db, schemaPath: string = SCHEMA_PATH): void => {
  const schemaSql = readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);
};
