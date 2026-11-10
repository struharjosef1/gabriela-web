# Gabriela 2026 na Renderu

Tento balíček přidává Dockerfile pro web a příkaz pro doručování oznámení. Podrobná konfigurace Supabase je v README.md. Nejprve postup projdi na odděleném testovacím projektu a se zkušebními daty.

1. Ověř migrační historii vybraného Supabase projektu. Pro novou prázdnou databázi použij migrace ze složky `supabase/migrations` v pořadí podle názvu. U stávající databáze nejdříve vytvoř zálohu a ověř plán na kopii. Nastav přihlašování jen na pozvánku, TOTP, SMTP a potvrzovací odkazy podle README.
2. Zdroj nahraj do soukromého repozitáře. V Renderu vytvoř Docker Web Service s kořenem repozitáře jako kontextem a s Dockerfile v kořeni. Health Check Path nastav na `/api/health`. Tato kontrola ověřuje dostupnost webu. Databázi a přílohy ověř samostatně.
3. V Renderu nastav tři veřejné proměnné před sestavením. `NEXT_PUBLIC_APP_URL` je skutečná HTTPS adresa služby. `NEXT_PUBLIC_SUPABASE_URL` je URL projektu Supabase. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` je jeho publishable klíč. Serverový `SUPABASE_SERVICE_ROLE_KEY` ulož jako tajnou proměnnou prostředí. Nikdy ho nedávej do build argumentu ani do zdrojových souborů. Po změně veřejných hodnot znovu sestav službu.
4. Pro oznámení vytvoř samostatný Render Cron Job nad stejným zdrojem. Nastav Docker Command na `npm run notifications` a rozvrh na `* * * * *`. Nastav stejné tři veřejné proměnné a serverové hodnoty `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` a `NOTIFICATIONS_FROM`. Spouštění nejdřív vyzkoušej proti zkušební databázi a ověřené odesílací doméně.
5. Po sestavení ověř přihlášení s MFA, pozvánku a obnovu hesla. Vyzkoušej přístup rolí mezi dvěma organizacemi, celý průchod požadavku, doručení oznámení, čistou přílohu a odmítnutí testovacího souboru EICAR. ClamAV aktualizuje signatury po startu služby. Přílohy se zpřístupní teprve po úspěšné kontrole. V logu ověř aktualizaci signatur a při zátěžovém testu zkontroluj paměť a čas skenování.
6. Obnov databázi i soubory ze zálohy v odděleném prostředí. Po ověření použij stejný postup pro ostrý projekt s vlastními hodnotami a samostatnou konfigurací.

Hesla a tajné klíče ukládej přímo do určených nastavení služeb.
