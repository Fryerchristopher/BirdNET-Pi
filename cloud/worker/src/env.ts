export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  ADMIN_AUTH: 'access' | 'token' | 'open';
  ACCESS_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  INGEST_TOKEN?: string;
  ADMIN_TOKEN?: string;
  FLICKR_API_KEY?: string;
  NOTIFY_WEBHOOK?: string;
  AI_GATEWAY_URL?: string;
  AI_GATEWAY_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  IP_SALT?: string;
}

/** Per-request values set by middleware. */
export interface Vars {
  station: string;
  admin: boolean;
}

export type AppEnv = { Bindings: Env; Variables: Vars };
