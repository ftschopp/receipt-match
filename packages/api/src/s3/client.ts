import { S3Client } from '@aws-sdk/client-s3';
import { localCredentials, type Config } from '../config';

export const s3Client = (config: Config) =>
  new S3Client({
    region: config.AWS_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    // The SDK's default flexible checksums sign a CRC32 of the (empty) payload into presigned
    // PUT URLs, so every browser upload would fail with BadDigest.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    ...(config.S3_ENDPOINT && { endpoint: config.S3_ENDPOINT }),
    ...(localCredentials(config) && { credentials: localCredentials(config) }),
  });
