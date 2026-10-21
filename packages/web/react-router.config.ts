import type { Config } from '@react-router/dev/config';

// SPA mode: no runtime server. The API lives in AWS Lambda; the UI is static files.
export default {
  ssr: false,
} satisfies Config;
