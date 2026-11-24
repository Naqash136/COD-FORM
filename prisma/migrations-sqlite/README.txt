SQLite migration history, preserved and not used.

Prisma Migrate applies every directory in prisma/migrations. The SQL in this
folder was created for SQLite (DATETIME columns) and must not be applied to
PostgreSQL. The PostgreSQL baseline is prisma/migrations/20261124000000_create_session_table.

prisma/dev.sqlite is unchanged and remains gitignored.
