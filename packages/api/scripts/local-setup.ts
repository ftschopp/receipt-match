/**
 * Prepares the local emulator (docker-compose.yml): recreates the table, creates the uploads
 * bucket with CORS for the web app, and seeds the demo data. Safe to re-run: it resets state.
 *
 *   npm run local:setup
 */
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import * as employeesDb from '../src/dynamo/employees';
import { createTable, tableDefinition } from '../src/dynamo/table';
import * as transactionsDb from '../src/dynamo/transactions';
import { employees, transactions } from '../seed/demo-company';

// Must match `params.local` in serverless.yml.
const ENDPOINT = 'http://localhost:4567';
const TABLE = 'receipt-match-local';
const BUCKET = 'receipt-match-uploads-local';
const options = { region: 'us-east-1', endpoint: ENDPOINT, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } };

const dynamo = new DynamoDBClient(options);
const s3 = new S3Client({ ...options, forcePathStyle: true });

async function resetTable() {
  const { TableNames = [] } = await dynamo.send(new ListTablesCommand({}));
  if (TableNames.includes(TABLE)) await dynamo.send(new DeleteTableCommand({ TableName: TABLE }));
  await dynamo.send(new CreateTableCommand({ TableName: TABLE, ...tableDefinition }));
  await waitUntilTableExists({ client: dynamo, maxWaitTime: 30 }, { TableName: TABLE });
}

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: {
        CORSRules: [{ AllowedMethods: ['GET', 'PUT'], AllowedOrigins: ['*'], AllowedHeaders: ['*'], MaxAgeSeconds: 3000 }],
      },
    }),
  );
}

async function seed() {
  const table = createTable(dynamo, TABLE);
  for (const e of employees) await employeesDb.put(table, e);
  for (const t of transactions) await transactionsDb.put(table, t);
}

try {
  await resetTable();
  await ensureBucket();
  await seed();
  console.log(`Local setup done: table ${TABLE} (${employees.length} employees, ${transactions.length} transactions), bucket ${BUCKET}.`);
} catch (error) {
  console.error(`Local setup failed. Is the emulator running? Try \`docker compose up -d\`.\n`, error);
  process.exit(1);
}
