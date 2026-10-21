import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createDynamoDBLogger, Table } from '@ftschopp/dynatable-core';

/**
 * Single-table design (TECH_SPEC §5). One table, primary key PK/SK, two GSIs.
 *
 * | Entity      | PK                | SK                    | GSI1                         | GSI2                     |
 * |-------------|-------------------|-----------------------|------------------------------|--------------------------|
 * | Employee    | EMP#<id>          | PROFILE               |                              | EMPLOYEES / EMP#<name>   |
 * | Transaction | TX#<id>           | TX                    | EMP#<employeeId>#TX / <authorizedAt> | TXS / <authorizedAt> |
 * | Receipt     | RCPT#<id>         | RCPT                  | EMP#<employeeId>#RCPT / <uploadedAt> | RCPTS / <uploadedAt> |
 * | Decision    | RCPT#<receiptId>  | DECISION#<decidedAt>  |                              |                          |
 * | Fingerprint | FP#<fingerprint>  | RCPT#<receiptId>      |                              |                          |
 *
 * Index names match the key prefixes (GSI1 → GSI1PK/GSI1SK) so dynatable resolves
 * business attributes to index keys by convention.
 */

const money = {
  type: Object,
  schema: {
    amountMinor: { type: Number, required: true },
    currency: { type: String, required: true },
  },
} as const;

const openObject = { type: Object, schema: {} } as const;

export const schema = {
  format: 'dynatable:1.0.0',
  version: '1.0.0',
  indexes: {
    primary: { hash: 'PK', sort: 'SK' },
    GSI1: { hash: 'GSI1PK', sort: 'GSI1SK' },
    GSI2: { hash: 'GSI2PK', sort: 'GSI2SK' },
  },
  models: {
    Employee: {
      key: {
        PK: { type: String, value: 'EMP#${id}' },
        SK: { type: String, value: 'PROFILE' },
      },
      index: {
        GSI2PK: { type: String, value: 'EMPLOYEES' },
        GSI2SK: { type: String, value: 'EMP#${name}' },
      },
      attributes: {
        id: { type: String, required: true },
        name: { type: String, required: true },
        department: { type: String, required: true },
      },
    },

    Transaction: {
      key: {
        PK: { type: String, value: 'TX#${id}' },
        SK: { type: String, value: 'TX' },
      },
      index: {
        GSI1PK: { type: String, value: 'EMP#${employeeId}#TX' },
        GSI1SK: { type: String, value: '${authorizedAt}' },
        GSI2PK: { type: String, value: 'TXS' },
        GSI2SK: { type: String, value: '${authorizedAt}' },
      },
      attributes: {
        id: { type: String, required: true },
        employeeId: { type: String, required: true },
        authorizedAt: { type: String, required: true },
        merchantDescriptor: { type: String, required: true },
        mcc: { type: String, required: true },
        merchantCity: { type: String, required: true },
        merchantCountry: { type: String, required: true },
        merchantTimezone: { type: String, required: true },
        cardPresent: { type: Boolean, required: true },
        amount: { ...money, required: true },
        originalAmount: money,
        receiptId: { type: String },
      },
    },

    Receipt: {
      key: {
        PK: { type: String, value: 'RCPT#${id}' },
        SK: { type: String, value: 'RCPT' },
      },
      index: {
        GSI1PK: { type: String, value: 'EMP#${employeeId}#RCPT' },
        GSI1SK: { type: String, value: '${uploadedAt}' },
        GSI2PK: { type: String, value: 'RCPTS' },
        GSI2SK: { type: String, value: '${uploadedAt}' },
      },
      attributes: {
        id: { type: String, required: true },
        employeeId: { type: String, required: true },
        kind: { type: String, required: true },
        mimeType: { type: String, required: true },
        uploadedAt: { type: String, required: true },
        status: { type: String, required: true },
        extractionStatus: { type: String, required: true },
        anchorTransactionId: { type: String },
        // Nested domain structures, stored as maps. `schema: {}` validates "any object":
        // their shape is owned and tested by the domain types.
        extraction: openObject,
        image: openObject,
        date: openObject,
        match: openObject,
        risk: openObject,
        currency: openObject,
        signals: { type: Array, items: openObject, default: [] },
      },
    },

    Decision: {
      key: {
        PK: { type: String, value: 'RCPT#${receiptId}' },
        SK: { type: String, value: 'DECISION#${decidedAt}' },
      },
      attributes: {
        receiptId: { type: String, required: true },
        decidedAt: { type: String, required: true },
        transactionId: { type: String },
        decision: { type: String, required: true },
        riskLevelAtDecision: { type: String },
        note: { type: String },
      },
    },

    Fingerprint: {
      key: {
        PK: { type: String, value: 'FP#${fingerprint}' },
        SK: { type: String, value: 'RCPT#${receiptId}' },
      },
      attributes: {
        fingerprint: { type: String, required: true },
        receiptId: { type: String, required: true },
      },
    },
  },
  params: {
    timestamps: false,
    cleanInternalKeys: true,
  },
} as const;

/** Table definition shared by the local setup script. serverless.yml declares the same for AWS. */
export const tableDefinition = {
  AttributeDefinitions: ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK'].map((name) => ({
    AttributeName: name,
    AttributeType: 'S' as const,
  })),
  KeySchema: [
    { AttributeName: 'PK', KeyType: 'HASH' as const },
    { AttributeName: 'SK', KeyType: 'RANGE' as const },
  ],
  GlobalSecondaryIndexes: ['GSI1', 'GSI2'].map((name) => ({
    IndexName: name,
    KeySchema: [
      { AttributeName: `${name}PK`, KeyType: 'HASH' as const },
      { AttributeName: `${name}SK`, KeyType: 'RANGE' as const },
    ],
    Projection: { ProjectionType: 'ALL' as const },
  })),
  BillingMode: 'PAY_PER_REQUEST' as const,
};

export const createTable = (client: DynamoDBClient, tableName: string, log = false) =>
  new Table({
    name: tableName,
    client,
    schema,
    ...(log && { logger: createDynamoDBLogger({ enabled: true, logParams: true, logResponse: false }) }),
  });

export type ReceiptTable = ReturnType<typeof createTable>;
