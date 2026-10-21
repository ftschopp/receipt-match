import type { ListEmployeesResponse } from '../../../http/contract';
import type { Employee } from '../../../domain';
import { ok, type HttpResult } from '../../../http/responses';

export type ListEmployeesDeps = { listEmployees: () => Promise<Employee[]> };

/** GET /employees */
export const listEmployees = (deps: ListEmployeesDeps) => async (): Promise<HttpResult> => {
  const body: ListEmployeesResponse = { employees: await deps.listEmployees() };
  return ok(body);
};
