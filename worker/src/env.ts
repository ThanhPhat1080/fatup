export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  API_TOKEN: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  /** Optional override of the storage limit shown to clients, in GB. Defaults to the R2 free tier (10 GB). */
  R2_QUOTA_GB?: string;
};
