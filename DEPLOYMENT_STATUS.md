# Stav nasazení – 10. listopadu 2026

Web: https://gabriela-2026.onrender.com
Render: srv-dbpfp7jbc2fs73a2rta0, Frankfurt, plán free.
Supabase: ewuwgcfvcvwfklrkfqez, obnovený projekt GABRIELA.

## Dokončeno
- Zdrojový kód nahrán do tohoto repozitáře.
- Produkční sestavení, TypeScript, databázový test a HTTP test prošly.
- Devět původních prázdných tabulek bylo zachováno v nepřístupném schématu gabriela_legacy_20261110.
- Aplikováno 13 migrací; lokální názvy odpovídají skutečné historii Supabase.
- Všech 32 aplikačních tabulek má RLS; anonymní klient nemá přístup k tabulkám ani autorizačním funkcím.
- Privátní bucket gabriela-private, maximálně 20 MB.

## Před ostrým provozem
- Založit a ověřit účet vlastníka přes Supabase Auth, nastavit jeho heslo a MFA.
- Pro potvrzené UUID účtu zavolat gab_provision_organization.
- Nastavit Auth: registrace jen na pozvánku, Site URL a přesměrování na /auth/potvrdit, e-mailové šablony, SMTP.
- V Render Environment doplnit serverové tajemství SUPABASE_SERVICE_ROLE_KEY.
- Dořešit prostředky pro ClamAV. Bezplatná instance při aktualizaci signatur dosáhla téměř 512 MB a web vracel 502.
- Na bezplatném plánu je CLAMAV_ENABLED=false: aktualizace signatur neběží a přílohy jsou odmítány, nikoli přijímány bez kontroly.
- Před zapnutím CLAMAV_ENABLED=true vybrat a schválit dostatečnou kapacitu a ověřit čistou přílohu i EICAR.
- Doplnit ověřeného e-mailového poskytovatele (RESEND_API_KEY, NOTIFICATIONS_FROM) a plánovač doručování.
- V Renderu nastavit HTTP Health Check Path /api/health; nyní se používá výchozí TCP kontrola.
- Ověřit živé přihlášení, obnovu hesla, MFA, pozvánky, Storage, oznámení a obnovu ze zálohy.

Úspěšný deploy ani průchod lokálních testů neznamená dokončenou přejímku ostrého provozu.
Tajné hodnoty nepatří do tohoto repozitáře.
