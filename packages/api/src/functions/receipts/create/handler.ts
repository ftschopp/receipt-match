import type { CreateReceiptBody, CreateReceiptResponse } from '../../../http/contract';
import { found, newReceipt, type Employee, type Receipt } from '../../../domain';
import { created, type HttpResult } from '../../../http/responses';

export type CreateReceiptDeps = {
  getEmployee: (id: string) => Promise<Employee | null>;
  saveReceipt: (receipt: Receipt) => Promise<void>;
  uploadUrl: (receiptId: string, mimeType: string) => Promise<CreateReceiptResponse['upload']>;
  newId: () => string;
  now: () => Date;
};

/** POST /receipts: registers the receipt and returns a presigned URL for the browser to upload to S3. */
export const createReceipt =
  (deps: CreateReceiptDeps) =>
  async ({ body }: { body: CreateReceiptBody }): Promise<HttpResult> => {
    found(await deps.getEmployee(body.employeeId), 'Employee', body.employeeId);
    const receipt = newReceipt(body, { id: deps.newId(), now: deps.now() });
    await deps.saveReceipt(receipt);
    const response: CreateReceiptResponse = { receipt, upload: await deps.uploadUrl(receipt.id, receipt.mimeType) };
    return created(response);
  };
