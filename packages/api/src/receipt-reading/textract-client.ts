import { TextractClient } from '@aws-sdk/client-textract';
import type { Config } from '../config';

/** Uses the default AWS credentials even when DynamoDB and S3 are local, so real Textract works locally. */
export const textractClient = (config: Config) => new TextractClient({ region: config.AWS_REGION });
