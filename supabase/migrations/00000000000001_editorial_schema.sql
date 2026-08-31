-- Telegram / nieczekai.pl — schemat redakcyjny.
-- Zastepuje plik state/editorial-state.json prawdziwa baza. Modeluje 1:1
-- struktury z src/store.mjs: events, validationContexts, publications, reactions.

create extension if not exists pgcrypto;

-- === STATUSY I KATEGORIE ===============================================
-- Odpowiadaja dokladnie zbiorom uzywanym w server.mjs (categories) oraz
-- store.mjs (event.status: review/approved/rejected/published).
create type editorial_status as enum ('review', 'approved', 'rejected', 'published');
create type editorial_category as enum ('kraj', 'biznes', 'gospodarka', 'geopolityka', 'rynki', 'świat', 'technologia', 'inne');

-- === EVENTS ==============================================================
-- Odpowiada kluczowi "events" w editorial-state.json. Jedno wydarzenie
-- wykryte przez agregator (aggregator.mjs -> scrapeGroup), z pakietem
-- redakcyjnym wygenerowanym przez model (generator.mjs).
create table public.events (
  id text primary key,                          -- stableId(topicKey), np. "live-<hash12>"
  topic_key text not null,                       -- topicIdentity(): deduplikacja tego samego wydarzenia
  topic_signature text[] not null default '{}',  -- topicSignature(): 12 najczestszych tokenow tematu
  canonical_urls text[] not null default '{}',   -- canonicalArticleUrl() dla kazdego artykulu w grupie

  title text not null default '',
  level1 text not null default '',               -- skrot 20-30 slow (originality)
  level2 text not null default '',                -- kontekst 60-140 slow (contextOriginality)
  category editorial_category not null default 'inne',
  tags text[] not null default '{}',

  image jsonb,                                    -- {url, alt, credit} albo null
  confidence smallint not null default 0 check (confidence between 0 and 100),
  status editorial_status not null default 'review',

  detected_at text,                                -- formatTime() z aggregator.mjs, tekst do wyswietlenia
  sources jsonb not null default '[]',             -- [{domain,time,title,url,wordCount,extractionMethod,summary,preview,keyClaims}]
  facts text[] not null default '{}',
  verification jsonb not null default '{}',        -- buildVerification(): sharedClaims/conflicts/uniqueClaims/essenceBasis/method

  -- Generacja modelu (generator.mjs -> generateEditorialPackage)
  generation_status text,                          -- ready / blocked-* / passed
  generation_reason text,
  generation_model text,
  generation_basis_ids smallint[] not null default '{}',
  originality jsonb,                                -- wynik validateOriginality(level1)
  context_originality jsonb,                        -- wynik validateContextOriginality(level2)
  metadata_validation jsonb,                        -- wynik validateEditorialMetadata()
  regenerated_at timestamptz,

  editorial_updated_at timestamptz,                 -- ustawiane, gdy redaktor recznie edytowal (store.updateEditorial)
  approved_at timestamptz,
  rejected_at timestamptz,
  published_at timestamptz,

  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index events_status_idx on public.events (status);
create index events_updated_at_idx on public.events (updated_at desc);
create index events_topic_key_idx on public.events (topic_key);
create index events_canonical_urls_idx on public.events using gin (canonical_urls);
create index events_topic_signature_idx on public.events using gin (topic_signature);

comment on table public.events is 'Wydarzenia wykryte przez agregator wraz z pakietem redakcyjnym. Odpowiada kluczowi events w starym editorial-state.json.';

-- === VALIDATION CONTEXTS =================================================
-- Odpowiada kluczowi "validationContexts". Pelne teksty zrodlowe, potrzebne
-- do ponownej walidacji przy edycji redaktora i do regeneracji (action=regenerate).
create table public.validation_contexts (
  event_id text primary key references public.events(id) on delete cascade,
  source_texts text[] not null default '{}',
  claim_texts text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on table public.validation_contexts is 'Pelne teksty zrodlowe uzyte do wygenerowania i weryfikacji materialu. 1:1 z validationContexts w starym store.';

-- === PUBLICATIONS =========================================================
-- Odpowiada kluczowi "publications". Wylacznie materialy, ktore przeszly
-- przez akcje "publish" (store.publish). To one trafiaja do /api/public/feed
-- i /a/<id>. NIGDY nie tworzone bezposrednio z events.
create table public.publications (
  id text primary key references public.events(id) on delete cascade,
  title text not null default '',
  image jsonb,
  level1 text not null default '',
  level2 text not null default '',
  category editorial_category not null default 'inne',
  tags text[] not null default '{}',
  confidence smallint not null default 0,
  sources jsonb not null default '[]',              -- zredukowane: {domain,time,title,url}
  source_count integer not null default 0,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index publications_published_at_idx on public.publications (published_at desc);

comment on table public.publications is 'Materialy opublikowane w publicznym feedzie. Odpowiada kluczowi publications w starym store; nigdy nie zawiera materialow review/rejected.';

-- === REACTIONS ============================================================
-- Odpowiada kluczowi "reactions". Wylacznie zagregowane liczniki - zgodnie
-- z zasada z server.mjs "Bez identyfikatorow: klient przesyla zmiane wlasnego
-- glosu, serwer trzyma tylko liczniki." Nie przechowujemy adresow IP.
create table public.reactions (
  publication_id text primary key references public.publications(id) on delete cascade,
  likes integer not null default 0 check (likes >= 0),
  dislikes integer not null default 0 check (dislikes >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.reactions is 'Wylacznie zagregowane liczniki ocen. Zadnych identyfikatorow czytelnikow ani adresow IP - zgodnie z projektem w server.mjs.';

-- === LAST SYNC (metadane) =================================================
-- Odpowiada kluczowi "lastSync". Jeden wiersz, nadpisywany przy kazdej synchronizacji.
create table public.sync_runs (
  id boolean primary key default true check (id),  -- wymusza pojedynczy wiersz (singleton)
  synced_at timestamptz,
  stats jsonb not null default '{}',
  errors jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

comment on table public.sync_runs is 'Metadane ostatniej synchronizacji agregatora. Singleton - jeden wiersz.';

-- === updated_at automatycznie ============================================
create function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();

create trigger publications_set_updated_at before update on public.publications
  for each row execute function public.set_updated_at();

create trigger reactions_set_updated_at before update on public.reactions
  for each row execute function public.set_updated_at();

create trigger sync_runs_set_updated_at before update on public.sync_runs
  for each row execute function public.set_updated_at();

-- === RLS ===================================================================
-- Serwer laczy sie kluczem service_role (omija RLS z definicji), a wiec te
-- polityki zabezpieczaja WYLACZNIE ewentualny dostep kluczem anon/publishable
-- (np. gdyby ktos przypadkowo uzyl go w kliencie). Domyslnie: brak dostepu.
alter table public.events enable row level security;
alter table public.validation_contexts enable row level security;
alter table public.publications enable row level security;
alter table public.reactions enable row level security;
alter table public.sync_runs enable row level security;

-- publications i reactions moga byc czytane publicznie (to jest publiczny feed) -
-- ale WYLACZNIE do odczytu. Zapis idzie tylko przez backend (service_role).
create policy "publications_public_read" on public.publications
  for select to anon, authenticated using (true);

create policy "reactions_public_read" on public.reactions
  for select to anon, authenticated using (true);

-- events, validation_contexts, sync_runs: zero dostepu z kluczy publicznych.
-- Redaktor loguje sie Basic Auth do backendu, ktory uzywa service_role.
-- (brak polityk = domyslna odmowa przy wlaczonym RLS)
