import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { localCredentials, type Config } from '../config';
import { createTable } from './table';

/** The single table, on a client that points at the local emulator (with its own credentials) or at AWS. */
export const dynamoTable = (config: Config) =>
  createTable(
    new DynamoDBClient({
      region: config.AWS_REGION,
      ...(config.DYNAMODB_ENDPOINT && { endpoint: config.DYNAMODB_ENDPOINT }),
      ...(localCredentials(config) && { credentials: localCredentials(config) }),
    }),
    config.TABLE_NAME,
    config.LOG_DYNAMODB,
  );
