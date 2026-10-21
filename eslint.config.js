// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Architecture boundaries, enforced. The linter's job here is to keep the layers honest:
 *
 *   api/src/domain  pure logic: no AWS, no Middy, no React, no Zod, no Node I/O, no other API folder
 *   handler.ts      the logic of a Lambda: receives every dependency injected; no Middy, no clients
 *   web             never reaches into the API's code or AWS; it talks to the API over HTTP
 */

const AWS = { group: ['@aws-sdk/*', '@ftschopp/dynatable-core'], message: 'Talk to AWS from the api package, not here.' };
const MIDDY = { group: ['@middy/*'], message: 'Middy belongs in lambda.ts and http/middleware.ts.' };
const REACT = { group: ['react', 'react-dom', 'react-router', '@react-router/*'], message: 'UI code belongs in the web package.' };
const API = { group: ['@receipt-match/api', '@receipt-match/api/*', '**/api/src/**'], message: 'The web talks to the API over HTTP; it does not import its code.' };

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/build/**', '**/.react-router/**', '**/.esbuild/**', '**/.serverless/**', 'fixtures/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
  },
  {
    files: ['packages/api/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            AWS,
            MIDDY,
            REACT,
            {
              group: ['**/dynamo/*', '**/s3/*', '**/receipt-reading/*', '**/http/*', '**/functions/*'],
              message: 'The domain depends on nothing else in the API: I/O is passed in as functions.',
            },
            // The API's env config (src/config.ts), not the domain's own matching/ and verification/ configs.
            { regex: '^(\\.\\./)+config$', message: 'The domain does not read the environment: pass settings in.' },
            { group: ['zod'], message: 'Validation of external input belongs in http/contract.ts.' },
            { group: ['node:*', 'fs', 'fs/*', 'path', 'http', 'https', 'child_process'], message: 'The domain does no I/O: inject it.' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/api/src/functions/**/handler.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            AWS,
            MIDDY,
            {
              group: ['**/dynamo/*', '**/s3/*', '**/receipt-reading/*', '**/config', '**/http/middleware'],
              message: 'Handlers get their I/O injected by lambda.ts; import only domain, http/contract and http/responses.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/web/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [AWS, MIDDY, API, { group: ['zod'], message: 'Validation happens in the API.' }] }],
    },
  },
);
