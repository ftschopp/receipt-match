import { z } from 'zod';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  STAGE: z.string().default('local'),
  AWS_REGION: z.string().default('us-east-1'),
  TABLE_NAME: z.string().default('receipt-match-local'),
  UPLOADS_BUCKET: z.string().default('receipt-match-uploads-local'),
  /** `fixture` replays recorded Textract responses; `textract` calls AWS. */
  EXTRACTOR: z.enum(['fixture', 'textract']).default('fixture'),
  FIXTURES_DIR: z.string().default('../../fixtures/receipts'),
  /** The company's currency: what a bare "$" on a receipt is read as. */
  DEFAULT_CURRENCY: z.string().length(3).default('ARS'),
  /** Local emulator endpoints (Floci). Unset in AWS. */
  DYNAMODB_ENDPOINT: z.url().optional(),
  S3_ENDPOINT: z.url().optional(),
  /** The local emulator needs path-style URLs (http://localhost:4567/bucket/key). */
  S3_FORCE_PATH_STYLE: flag,
  /**
   * Credentials for the local emulators only. Textract keeps the default AWS credential chain,
   * so real Textract can be used while DynamoDB and S3 run locally.
   */
  LOCAL_ACCESS_KEY_ID: z.string().optional(),
  LOCAL_SECRET_ACCESS_KEY: z.string().optional(),
  LOG_DYNAMODB: flag,
});

export type Config = z.infer<typeof envSchema>;

/** Parses and validates the environment. Serverless renders unset optional parameters as empty strings. */
export const parseConfig = (env: Record<string, string | undefined>): Config =>
  envSchema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));

/** Credentials for the local emulators only; undefined in AWS, where the Lambda role is used. */
export const localCredentials = (config: Config) =>
  config.LOCAL_ACCESS_KEY_ID && config.LOCAL_SECRET_ACCESS_KEY
    ? { accessKeyId: config.LOCAL_ACCESS_KEY_ID, secretAccessKey: config.LOCAL_SECRET_ACCESS_KEY }
    : undefined;
