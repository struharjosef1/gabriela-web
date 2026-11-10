import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GABRIELA 2026', short_name: 'GABRIELA', description: 'Správa bytových domů',
    start_url: '/dashboard', display: 'standalone', background_color: '#f4f7f9', theme_color: '#15354f',
    icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
  };
}
