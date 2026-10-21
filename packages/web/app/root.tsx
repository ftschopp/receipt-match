import { isRouteErrorResponse, Link, Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration } from 'react-router';
import type { Route } from './+types/root';
import { isApiError } from './lib/api';
import './app.css';

export const links: Route.LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
];

export function meta() {
  return [{ title: 'ReceiptMatch' }, { name: 'description', content: 'Match receipts to card transactions and check them against the card network.' }];
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 font-medium transition ${isActive ? 'bg-slate-100 text-ink' : 'text-slate-500 hover:text-ink'}`;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">RM</span>
            ReceiptMatch
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navClass}>
              Overview
            </NavLink>
          </nav>
          <Link
            to="/receipts/new"
            className="ml-auto whitespace-nowrap rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white shadow-sm transition hover:bg-brand-700"
          >
            Upload receipt
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

export function HydrateFallback() {
  return (
    <Shell>
      <p className="text-slate-500">Loading…</p>
    </Shell>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = 'Something went wrong';
  let detail = 'Unexpected error.';
  if (isApiError(error)) {
    title = error.status === 404 ? 'Not found' : 'The API returned an error';
    detail = error.message;
  } else if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
  } else if (error instanceof TypeError) {
    title = "Can't reach the API";
    detail = `Is it running? Start it with \`npm run dev:api\`. (${error.message})`;
  } else if (error instanceof Error) {
    detail = error.message;
  }
  return (
    <Shell>
      <div className="max-w-xl rounded-xl border border-rose-200 bg-white p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-slate-600">{detail}</p>
        <Link to="/" className="mt-4 inline-block font-medium text-brand-600 hover:underline">
          Back to overview
        </Link>
      </div>
    </Shell>
  );
}
