const tones: Record<string, string> = {
  'Nové': 'red', 'Havárie': 'red', 'Urgentní': 'orange', 'Vysoká': 'orange',
  'Pracuje se na tom': 'blue', 'Přijato': 'blue', 'Čeká na dodavatele': 'purple',
  'Čeká na uživatele': 'amber', 'Vyřešeno': 'green', 'Uzavřeno': 'gray',
  'Běžná': 'gray', 'Nízká': 'gray'
};
export function StatusBadge({ children }: { children: React.ReactNode }) {
  return <span className={`badge ${tones[String(children)] ?? 'gray'}`}>{children}</span>;
}
