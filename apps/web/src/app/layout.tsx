import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { QueryProvider } from '@/components/query-provider';

import './globals.css';

export const metadata: Metadata = {
  title: 'Project Atlas',
  description: 'BIST tarama ve analiz platformu',
};

interface RootLayoutProps {
  readonly children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="tr">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
