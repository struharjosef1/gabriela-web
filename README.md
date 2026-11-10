# GABRIELA 2026 · web 0.3.0

Český řídicí panel správy bytových domů. Web používá Next.js a Supabase Auth, PostgreSQL, privátní Storage a RLS. Vychází z balíčku v0.2.0 a sjednocené specifikace v4.0.

## Zkušební provoz

Na Macu otevři `START_GABRIELA.command`, ve Windows `START_GABRIELA_WINDOWS.bat`. Potřebuješ Node.js 22 nebo novější. První spuštění stáhne závislosti podle přiložených lockfile. Stránka se otevře na `http://127.0.0.1:3100/login`. Přihlašovací formulář nabízí výběr zkušební role.

Zkušební služba běží pouze na loopbacku a používá PostgreSQL v paměti přes PGlite. Má oddělené smyšlené účty pro vlastníka, správce, obyvatele a technika. Po ukončení změny zaniknou. Zkušební přihlášení nevytváří skutečné účty v Supabase. Doručování, antivirová kontrola a soukromé úložiště potřebují nakonfigurované služby.

## Provoz pro skutečnou organizaci

1. Založ oddělené testovací a produkční prostředí v účtu vlastníka projektu. Před jakoukoli změnou stávajícího projektu exportuj skutečné schéma, migrační historii, pravidla přístupu a konfiguraci Storage. Balíček obsahuje návazné migrace i opravené číslování starší řady. Do již založené databáze nepouštěj starou řadu podruhé. Porovnej ji a srovnej migrační historii nejprve na testovací kopii.
2. Pro nový testovací projekt aplikuj SQL soubory v `supabase/migrations` podle pořadí. V Supabase Auth vypni veřejné zakládání účtů, nastav oficiální adresu webu a povolené přesměrování na `/auth/potvrdit`. Aktivuj TOTP. Nastav SMTP pro pozvánky a obnovu hesla.
3. Přihlašovací e-mail pro pozvánku nastav na odkaz `{{ .SiteURL }}/auth/potvrdit?token_hash={{ .TokenHash }}&type=invite`. Pro obnovu použij stejnou cestu s `type=recovery`. Ověř jednorázové použití a expiraci na testovacím účtu. Účet se po potvrzení e-mailu připojí k organizaci přijetím pozvánky v části Můj účet. Uživatel si tam nastaví heslo. Existující účet přijímá pozvánku po přihlášení.
4. V Supabase Auth vytvoř a ověř účet vlastníka. Jako provozní správce databáze založ organizaci příkazem `select public.gab_provision_organization('<UUID potvrzeného účtu>', 'Název organizace');`. Podporu nebo provozního správce platformy pověř jen prostřednictvím schváleného zápisu role `support_operator` nebo `platform_admin` v `platform_user_roles`. Vlastník schvaluje časově omezenou souhrnnou diagnostiku, přístupy se auditují.
5. Nastav proměnné podle `apps/web/.env.example` v nastavení hostingu. Veřejná URL a veřejný klíč musejí být nastavené už při sestavení. Privilegovaný klíč patří výhradně do serverových tajemství. Použij Node.js host s HTTPS a řízeným přístupem.
6. V adresáři `apps/web` spusť `npm ci`, `npm run build` a poté `npm start`. Pro soubory nastav aktuální ClamAV a privátní bucket z migrací. Otestuj příjem, odmítnutí infikovaného souboru, expirační odkaz a odebrání přístupu. Bez úspěšné kontroly server soubor nezpřístupní.
7. Pro oznámení nastav ověřenou odesílací doménu, `NOTIFICATIONS_FROM` a `RESEND_API_KEY`. Spouštěj `npm run notifications` ze zabezpečeného plánovače přibližně každou minutu. Úloha vytvoří oznámení po termínu, rezervuje čekající doručení, provede pokus a zaznamená výsledek. Vlastník vidí výsledek v Nastavení. Nastav monitoring dostupnosti a chyb fronty.
8. Na testovacím prostředí projdi role na dvou organizacích, pozvánku, obnovu hesla, MFA, soubor, e-mail, export a audit. Obnov databázi i Storage ze zálohy do odděleného projektu a ověř použitelný návrat na předchozí verzi. Po přejímce vlastníkem používej pilotní organizaci s omezeným rozsahem. Produkční přístup otevři až po odsouhlasení přejímky a provozních pravidel.

## Ověření

```sh
npm --prefix apps/web ci
npm --prefix demo ci
npm --prefix apps/web run typecheck
npm --prefix apps/web test
npm --prefix demo test
npm --prefix demo run test:http
npm --prefix apps/web run build
```

Test PostgreSQL ověřuje migrace, členství, MFA podmínku, izolaci dvou organizací, omezení správce na přidělené objekty, celý životní cyklus požadavku, privátní poznámky, odebrání role, autorizaci příloh, audit a opakování e-mailové úlohy. HTTP test používá skutečný Next.js web s testovacím rozhraním Auth a Data API nad týmž SQL schématem. Prochází formuláře požadavků a export CSV, XLSX a PDF.

Živé Supabase Auth, skutečné odeslání e-mailu, podepsané odkazy skutečného Storage, nasazení, obnova ze zálohy a přejímka na cílových zařízeních se ověřují v prostředí provozovatele. Desktopový instalátor a samostatné moduly revizí, zařízení a dokumentového hospodářství následují po stabilním webu.
