import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Folio · Statement Expense Organizer',
  description: 'A private workspace to turn statement files into reviewed expenses. Files are processed on your device.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
