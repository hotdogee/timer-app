-- Counters for the sign-in code emails (server/src/send-limit.ts): per address (a hash of it, never
-- the address itself) and per day, in fixed windows. Rows older than two days are pruned as new
-- ones are written. Not part of Better Auth's schema (0001_auth.sql is generated from it).
create table "sendLimit" ("key" text not null primary key, "windowStart" integer not null, "count" integer not null);

create index "sendLimit_windowStart_idx" on "sendLimit" ("windowStart");
