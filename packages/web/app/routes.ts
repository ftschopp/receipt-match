import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('receipts/new', 'routes/receipt-new.tsx'),
  route('receipts/:id', 'routes/receipt.tsx'),
] satisfies RouteConfig;
