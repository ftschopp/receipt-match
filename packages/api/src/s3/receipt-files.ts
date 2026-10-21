import { GetObjectCommand, NoSuchKey, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { domainError } from '../domain';

/**
 * Receipt files in S3. Browsers upload and view images through presigned URLs, so image bytes
 * never pass through API Gateway or Lambda payload limits.
 */

const UPLOAD_URL_TTL_SECONDS = 300;
const VIEW_URL_TTL_SECONDS = 900;

export const imageKey = (receiptId: string) => `receipts/${receiptId}/image`;
export const rawExtractionKey = (receiptId: string) => `receipts/${receiptId}/textract.json`;

export const getImage = async (s3: S3Client, bucket: string, receiptId: string): Promise<Uint8Array> => {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: imageKey(receiptId) }));
    if (!result.Body) throw new Error(`Image for receipt ${receiptId} is empty`);
    return await result.Body.transformToByteArray();
  } catch (error) {
    if (error instanceof NoSuchKey) throw domainError('INVALID_STATE', `The image for receipt ${receiptId} has not been uploaded yet`);
    throw error;
  }
};

/** Raw extractor output is kept in S3: it can exceed DynamoDB's 400 KB item limit. */
export const saveRawExtraction = async (s3: S3Client, bucket: string, receiptId: string, raw: unknown): Promise<void> => {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: rawExtractionKey(receiptId), Body: JSON.stringify(raw), ContentType: 'application/json' }),
  );
};

/** The browser must send exactly the returned headers, or the signature won't match. */
export const uploadUrl = async (s3: S3Client, bucket: string, receiptId: string, mimeType: string) => ({
  url: await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: imageKey(receiptId), ContentType: mimeType }), {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
  }),
  headers: { 'Content-Type': mimeType },
  expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
});

export const viewUrl = (s3: S3Client, bucket: string, receiptId: string): Promise<string> =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: imageKey(receiptId) }), { expiresIn: VIEW_URL_TTL_SECONDS });
