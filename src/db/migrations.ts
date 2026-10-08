import type Database from "better-sqlite3";

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * Migration 列表：按版本号升序追加，不要改历史条目。
 * 加表/加字段 → 末尾追加新 migration，写幂等 SQL。
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: "init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS books (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          name     TEXT NOT NULL UNIQUE,
          publish  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS formats (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id   INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          ext       TEXT NOT NULL,
          url       TEXT NOT NULL,
          size      TEXT NOT NULL,
          UNIQUE(book_id, ext)
        );

        CREATE TABLE IF NOT EXISTS pools (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          parent_url   TEXT NOT NULL,
          folder_name  TEXT NOT NULL,
          done         INTEGER NOT NULL DEFAULT 0,
          UNIQUE(parent_url, folder_name)
        );
      `);
    },
  },
  {
    version: 2,
    name: "library",
    up: (db) => {
      db.exec(`
        -- 分享链接表
        CREATE TABLE IF NOT EXISTS shares (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          url        TEXT NOT NULL UNIQUE,
          type       TEXT NOT NULL DEFAULT 'quark',  -- quark / baidu
          status     TEXT NOT NULL DEFAULT 'pending', -- pending / processing / done
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );

        -- 文件夹表（自关联父级）
        CREATE TABLE IF NOT EXISTS folders (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          share_id    INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
          parent_id   INTEGER REFERENCES folders(id) ON DELETE CASCADE,
          url         TEXT NOT NULL,
          name        TEXT NOT NULL,
          file_count  INTEGER NOT NULL DEFAULT 0,
          status      TEXT NOT NULL DEFAULT 'pending', -- pending / processing / done
          UNIQUE(share_id, parent_id, name)
        );

        -- 文件表
        CREATE TABLE IF NOT EXISTS files (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          share_id    INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
          folder_id   INTEGER REFERENCES folders(id) ON DELETE CASCADE,
          url         TEXT NOT NULL,
          name        TEXT NOT NULL,
          size        TEXT NOT NULL DEFAULT '',
          ext         TEXT NOT NULL DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'pending', -- pending / processing / done
          UNIQUE(share_id, folder_id, name)
        );

        CREATE INDEX IF NOT EXISTS idx_folders_share ON folders(share_id);
        CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
        CREATE INDEX IF NOT EXISTS idx_files_share ON files(share_id);
        CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
      `);
    },
  },
  {
    version: 3,
    name: "files-size-bytes",
    up: (db) => {
      db.exec(`ALTER TABLE files ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0`);
    },
  },
  {
    version: 4,
    name: "recommendations",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS book_recommendations (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          score       REAL NOT NULL,
          reason      TEXT NOT NULL DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'pending', -- pending / processing / done
          created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          UNIQUE(file_id)
        );
        CREATE INDEX IF NOT EXISTS idx_rec_status ON book_recommendations(status);
      `);
    },
  },

  {
    version: 5,
    name: "recommendations-workdir",
    up: (db) => {
      db.exec(`ALTER TABLE book_recommendations ADD COLUMN work_dir TEXT NOT NULL DEFAULT ''`);
    },
  },

  {
    version: 6,
    name: "scheduled-posts",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_posts (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          article_path TEXT NOT NULL UNIQUE,
          publish_at  TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'pending',
          created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_sched_time ON scheduled_posts(publish_at);
        CREATE INDEX IF NOT EXISTS idx_sched_status ON scheduled_posts(status);
      `);
    },
  },

  {
    version: 7,
    name: "scheduled-posts-channel",
    up: (db) => {
      // 1) 加 channel 列（默认 toutiao）
      db.exec(`ALTER TABLE scheduled_posts ADD COLUMN channel TEXT NOT NULL DEFAULT 'toutiao'`);
      // 2) 重建表：把 UNIQUE(article_path) 改成 UNIQUE(article_path, channel)，
      //    这样同一条文章可以同时排"头条任务"和"72小时后小红书任务"两条
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_posts_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          article_path TEXT NOT NULL,
          publish_at   TEXT NOT NULL,
          status       TEXT NOT NULL DEFAULT 'pending',
          channel      TEXT NOT NULL DEFAULT 'toutiao',
          created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          UNIQUE(article_path, channel)
        );
        INSERT OR IGNORE INTO scheduled_posts_new (id, article_path, publish_at, status, channel, created_at)
          SELECT id, article_path, publish_at, status, channel, created_at FROM scheduled_posts;
        DROP TABLE scheduled_posts;
        ALTER TABLE scheduled_posts_new RENAME TO scheduled_posts;
        CREATE INDEX IF NOT EXISTS idx_sched_time ON scheduled_posts(publish_at);
        CREATE INDEX IF NOT EXISTS idx_sched_status ON scheduled_posts(status);
      `);
    },
  },
];
