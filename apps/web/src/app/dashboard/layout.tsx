import type { Metadata } from 'next';

export const metadata: Metadata={title:'Přehled',robots:{index:false,follow:false}};
export const dynamic='force-dynamic';

export default function DashboardLayout({children}:{children:React.ReactNode}) {
  return children;
}
