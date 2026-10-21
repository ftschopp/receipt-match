import type { Employee } from '../domain';
import { toEmployee, toItem } from './items';
import type { ReceiptTable } from './table';

export const get = async (table: ReceiptTable, id: string): Promise<Employee | null> => {
  const item = await table.entities.Employee.get({ id }).execute();
  return item ? toEmployee(item) : null;
};

export const list = async (table: ReceiptTable): Promise<Employee[]> =>
  (await table.entities.Employee.query().where((attr, op) => op.beginsWith(attr.name, '')).useIndex('GSI2').execute()).map(toEmployee);

export const getMany = async (table: ReceiptTable, ids: string[]): Promise<Employee[]> =>
  ids.length === 0 ? [] : (await table.entities.Employee.batchGet(ids.map((id) => ({ id }))).execute()).map(toEmployee);

export const put = async (table: ReceiptTable, employee: Employee): Promise<void> => {
  await table.entities.Employee.put(toItem(employee) as never).execute();
};
