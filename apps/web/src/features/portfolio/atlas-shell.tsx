'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { portfolioApi } from './api';

const navigation = [
  { href: '/market', label: 'Piyasa' },
  { href: '/scanner', label: 'Scanner' },
  { href: '/strategies', label: 'Strategy Lab' },
  { href: '/portfolios', label: 'Portföyler' },
  { href: '/watchlists', label: 'Listeler' },
  { href: '/alerts', label: 'Alarmlar' },
  { href: '/notifications', label: 'Bildirimler' },
  { href: '/admin/operations', label: 'Operasyonlar' },
] as const;

export function AtlasShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: portfolioApi.unreadCount,
    retry: false,
  });

  return (
    <div className="portfolio-shell">
      <header className="portfolio-topbar">
        <Link className="scanner-brand" href="/">
          ATLAS / PİYASA MASASI
        </Link>
        <nav aria-label="Ürün navigasyonu" className="portfolio-nav">
          {navigation.map((item) => (
            <Link
              key={item.href}
              className={clsx(pathname.startsWith(item.href) && 'active')}
              href={item.href}
            >
              {item.label}
              {item.href === '/notifications' && (unread.data ?? 0) > 0 && (
                <span
                  className="nav-count"
                  aria-label={`${unread.data} okunmamış bildirim`}
                >
                  {unread.data}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </header>
      {children}
      <footer className="portfolio-footer">
        Veriler gecikmeli olabilir · Yatırım tavsiyesi değildir.
      </footer>
    </div>
  );
}

export function WorkspaceState({
  kind,
  children,
}: {
  readonly kind: 'loading' | 'error' | 'empty';
  readonly children: ReactNode;
}) {
  return (
    <div
      className={clsx('portfolio-state', kind)}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <span className="status-rail-dot" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}
