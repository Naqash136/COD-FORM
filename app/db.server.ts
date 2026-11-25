import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const CA_PATH = path.resolve(process.cwd(), "certs/prod-ca-2021.crt");

function connectionStringForPg(databaseUrl: string) {
  const queryIndex = databaseUrl.indexOf("?");
  return queryIndex === -1 ? databaseUrl : databaseUrl.slice(0, queryIndex);
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaPg({
    connectionString: connectionStringForPg(databaseUrl),
    max: 10,
    connectionTimeoutMillis: 30_000,
    idleTimeoutMillis: 30_000,
    ssl: {
      ca: fs.readFileSync(CA_PATH),
      rejectUnauthorized: true,
    },
  });

  return new PrismaClient({ adapter });
}

declare global {
  // The Prisma client is cached on globalThis in development. `var` is required for that declaration.
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
}

const prisma = global.prismaGlobal ?? createPrismaClient();

export default prisma;
