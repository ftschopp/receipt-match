import exifr from 'exifr';
import { Jimp } from 'jimp';
import { dhashFromGrayscale, type ImageFeatures, type ImageFormat, type ImageMeta } from '../domain';
import { sha256 } from './extract';

const FORMATS: Record<string, ImageFormat> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

/** 64-bit difference hash: the image shrunk to 9x8 grayscale. Null when it can't be decoded. */
const dhashOf = async (buffer: Buffer): Promise<string | null> => {
  try {
    const img = await Jimp.fromBuffer(buffer);
    img.resize({ w: 9, h: 8 }).greyscale();
    const { data } = img.bitmap; // RGBA; after greyscale R = G = B
    return dhashFromGrayscale(Array.from({ length: 72 }, (_, i) => data[i * 4]!));
  } catch {
    return null;
  }
};

/** Camera make and model, and the software that last saved the image, from EXIF. */
const exifOf = async (buffer: Buffer): Promise<Omit<ImageMeta, 'format'>> => {
  try {
    const tags = (await exifr.parse(buffer, ['Make', 'Model', 'Software'])) as { Make?: string; Model?: string; Software?: string } | undefined;
    return {
      ...(tags?.Make && { make: tags.Make.trim() }),
      ...(tags?.Model && { model: tags.Model.trim() }),
      ...(tags?.Software && { software: tags.Software.trim() }),
    };
  } catch {
    return {};
  }
};

/**
 * Fingerprints and metadata for verification. Uses jimp (pure JS) rather than sharp so there are
 * no native binaries to package for Lambda.
 */
export const analyzeImage = async (image: Uint8Array, mimeType: string): Promise<ImageFeatures> => {
  const format = FORMATS[mimeType] ?? 'other';
  // PDFs are digital-native documents: no pixels to hash cheaply, no camera metadata.
  if (format === 'pdf') return { sha256: sha256(image), dhash: null, meta: { format } };

  const buffer = Buffer.from(image);
  const [dhash, exif] = await Promise.all([dhashOf(buffer), exifOf(buffer)]);
  return { sha256: sha256(image), dhash, meta: { format, ...exif } };
};
