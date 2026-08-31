// Trwaly magazyn stanu redakcyjnego. Zastapil plik JSON prawdziwa baza
// Supabase/Postgres (projekt "Nieczekai", odrebny od bazy haloAgent).
// Publiczny interfejs (nazwy i sygnatury metod) jest identyczny jak w starej
// wersji na pliku JSON, wiec server.mjs nie wymaga zmian.
// supabase-js zawsze inicjuje klienta Realtime (nawet gdy nie uzywamy
// subskrypcji na zywo, wylacznie zapytania REST) i wymaga natywnego
// WebSocket API. Node 20 (produkcja) go nie ma - Node 22+ ma. Podstawiamy
// pakiet "ws" jako globalny WebSocket PRZED importem supabase-js, zeby
// biblioteka wykryla go jako dostepny, zamiast przekazywac opcje transportu.
if (typeof globalThis.WebSocket === "undefined") {
  const { default: WebSocket } = await import("ws");
  globalThis.WebSocket = WebSocket;
}
import { createClient } from "@supabase/supabase-js";

// Mapowania status <-> kategoria: kod aplikacji uzywa polskich znakow
// ("świat"), a enum w Postgresie jest identyczny, wiec nie ma potrzeby mapowania.
const STATUSES = new Set(["review", "approved", "rejected", "published"]);

function toEvent(row, publications) {
  if (!row) return null;
  const isPublished = Boolean(publications?.has(row.id));
  return {
    id: row.id,
    topicKey: row.topic_key,
    topicSignature: row.topic_signature || [],
    canonicalUrls: row.canonical_urls || [],
    title: row.title || "",
    level1: row.level1 || "",
    draft: row.level1 || "",
    level2: row.level2 || "",
    category: row.category || "inne",
    tags: row.tags || [],
    image: row.image || null,
    confidence: row.confidence || 0,
    status: row.status,
    detectedAt: row.detected_at || "",
    sources: row.sources || [],
    facts: row.facts || [],
    verification: row.verification || {},
    validationId: row.id,
    generation: {
      status: row.generation_status,
      reason: row.generation_reason,
      model: row.generation_model || "",
      basisIds: row.generation_basis_ids || [],
      originality: row.originality || null,
      contextOriginality: row.context_originality || null,
      metadataValidation: row.metadata_validation || null,
      regeneratedAt: row.regenerated_at,
    },
    editorialUpdatedAt: row.editorial_updated_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    publishedAt: isPublished ? row.published_at : null,
    syncedAt: row.synced_at,
    updatedAt: row.updated_at,
  };
}

function toPublication(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.id,
    title: row.title || "",
    image: row.image || null,
    level1: row.level1 || "",
    level2: row.level2 || "",
    category: row.category || "inne",
    tags: row.tags || [],
    confidence: row.confidence || 0,
    sources: row.sources || [],
    sourceCount: row.source_count || 0,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

export class EditorialStore {
  constructor(_filePath, options = {}) {
    const url = options.url || process.env.SUPABASE_URL;
    const key = options.serviceKey || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("Wymagane SUPABASE_URL i SUPABASE_SECRET_KEY (klucz service_role/secret, nie publishable).");
    }
    // Klucz secret laczy sie z pominieciem RLS - backend jest jedynym
    // miejscem, ktore moze pisac do events/validation_contexts/sync_runs.
    // Nie uzywamy subskrypcji Realtime, wylacznie zapytania REST, ale klient
    // supabase-js inicjuje konstruktor WebSocket zawsze przy tworzeniu instancji.
    // Node 20 (produkcja) nie ma natywnego WebSocket, wiec podajemy pakiet "ws".
    this.client = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: WebSocket } });
    // Podreczna mapa opublikowanych id, zeby toEvent() mogl ustawic publishedAt
    // bez dodatkowego zapytania przy kazdym odczycie.
    this.publishedIds = new Set();
  }

  async init() {
    const { data, error } = await this.client.from("publications").select("id");
    if (error) throw new Error(`Nie udalo sie polaczyc z Supabase: ${error.message}`);
    this.publishedIds = new Set((data || []).map((row) => row.id));
    return this;
  }

  async #refreshPublishedIds() {
    const { data, error } = await this.client.from("publications").select("id");
    if (!error) this.publishedIds = new Set((data || []).map((row) => row.id));
  }

  // Laczy wynik synchronizacji agregatora z istniejacym stanem. Zachowuje
  // tresc redaktora, jesli material byl juz recznie edytowany (editorialWasChanged).
  async mergeSynchronization(payload, contexts = {}) {
    const incomingEvents = payload.events || [];
    if (incomingEvents.length) {
      const ids = incomingEvents.map((event) => event.id);
      const { data: existingRows } = await this.client.from("events").select("*").in("id", ids);
      const existingById = new Map((existingRows || []).map((row) => [row.id, row]));

      const upserts = incomingEvents.map((incoming) => {
        const existing = existingById.get(incoming.id);
        const editorialWasChanged = Boolean(existing?.editorial_updated_at);
        const base = {
          id: incoming.id,
          topic_key: incoming.topicKey,
          topic_signature: incoming.topicSignature || [],
          canonical_urls: incoming.canonicalUrls || [],
          image: incoming.image || null,
          confidence: incoming.confidence || 0,
          detected_at: incoming.detectedAt || "",
          sources: incoming.sources || [],
          facts: incoming.facts || [],
          verification: incoming.verification || {},
          generation_status: incoming.generation?.status,
          generation_reason: incoming.generation?.reason,
          generation_model: incoming.generation?.model || "",
          generation_basis_ids: incoming.generation?.basisIds || [],
          originality: incoming.generation?.originality || null,
          context_originality: incoming.generation?.contextOriginality || null,
          synced_at: new Date().toISOString(),
        };
        if (existing) {
          return {
            ...base,
            title: editorialWasChanged ? existing.title : incoming.title,
            level1: editorialWasChanged ? existing.level1 : (incoming.level1 || incoming.draft || ""),
            level2: editorialWasChanged ? existing.level2 : (incoming.level2 || ""),
            category: editorialWasChanged ? existing.category : (incoming.category || "inne"),
            tags: editorialWasChanged ? existing.tags : (incoming.tags || []),
            status: existing.status || "review",
            editorial_updated_at: existing.editorial_updated_at || null,
            approved_at: existing.approved_at || null,
            rejected_at: existing.rejected_at || null,
          };
        }
        return {
          ...base,
          title: incoming.title,
          level1: incoming.level1 || incoming.draft || "",
          level2: incoming.level2 || "",
          category: incoming.category || "inne",
          tags: incoming.tags || [],
          status: "review",
          editorial_updated_at: null,
          approved_at: null,
          rejected_at: null,
        };
      });

      const { error: upsertError } = await this.client.from("events").upsert(upserts, { onConflict: "id" });
      if (upsertError) throw new Error(`Zapis wydarzen nie powiodl sie: ${upsertError.message}`);

      const contextRows = Object.entries(contexts).map(([id, context]) => ({
        event_id: id,
        source_texts: context.sourceTexts || [],
        claim_texts: context.claimTexts || [],
      }));
      if (contextRows.length) {
        const { error: contextError } = await this.client.from("validation_contexts").upsert(contextRows, { onConflict: "event_id" });
        if (contextError) throw new Error(`Zapis kontekstow walidacji nie powiodl sie: ${contextError.message}`);
      }
    }

    // Retencja: zamiast trzymac wszystko w jednym pliku (co roslo bez konca),
    // usuwamy najstarsze wydarzenia poza limitem 500, ktore nie sa opublikowane.
    const { data: allIds } = await this.client
      .from("events")
      .select("id, updated_at, status")
      .order("updated_at", { ascending: false });
    const overLimit = (allIds || []).slice(500).filter((row) => row.status !== "published").map((row) => row.id);
    if (overLimit.length) await this.client.from("events").delete().in("id", overLimit);

    await this.client.from("sync_runs").upsert({
      id: true,
      synced_at: payload.syncedAt,
      stats: payload.stats || {},
      errors: payload.errors || [],
    }, { onConflict: "id" });

    return this.listEvents();
  }

  async listEvents() {
    const { data, error } = await this.client.from("events").select("*").order("updated_at", { ascending: false });
    if (error) throw new Error(`Odczyt wydarzen nie powiodl sie: ${error.message}`);
    return (data || []).map((row) => toEvent(row, this.publishedIds));
  }

  async getEvent(id) {
    const { data, error } = await this.client.from("events").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Odczyt wydarzenia nie powiodl sie: ${error.message}`);
    return toEvent(data, this.publishedIds);
  }

  async getValidationContext(id) {
    const { data, error } = await this.client.from("validation_contexts").select("*").eq("event_id", id).maybeSingle();
    if (error || !data) return null;
    return { sourceTexts: data.source_texts || [], claimTexts: data.claim_texts || [] };
  }

  async getLastSync() {
    const { data } = await this.client.from("sync_runs").select("*").eq("id", true).maybeSingle();
    if (!data || !data.synced_at) return null;
    return { syncedAt: data.synced_at, stats: data.stats, errors: data.errors };
  }

  async #removePublication(id) {
    await this.client.from("publications").delete().eq("id", id);
    this.publishedIds.delete(id);
  }

  async updateEditorial(id, patch) {
    const now = new Date().toISOString();
    const update = {
      title: patch.title,
      level1: patch.level1,
      level2: patch.level2,
      category: patch.category,
      tags: patch.tags,
      editorial_updated_at: now,
      updated_at: now,
    };
    if (patch.validation) {
      update.originality = { ...patch.validation.short, validatedText: patch.validation.short.valid ? patch.level1 : "" };
      update.context_originality = { ...patch.validation.long, validatedText: patch.validation.long.valid ? patch.level2 : "" };
      update.metadata_validation = patch.validation.metadata;
    }
    if (this.publishedIds.has(id)) await this.#removePublication(id);
    if (patch.resetDecision) {
      const { data: current } = await this.client.from("events").select("status").eq("id", id).maybeSingle();
      if (current && ["approved", "published"].includes(current.status)) {
        update.status = "review";
        update.approved_at = null;
      }
    }
    const { data, error } = await this.client.from("events").update(update).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(`Aktualizacja materialu nie powiodla sie: ${error.message}`);
    return toEvent(data, this.publishedIds);
  }

  // Nadpisuje material swiezym pakietem z modelu (przycisk "Wygeneruj ponownie").
  // Kasuje slad edycji redaktora i cofa material do decyzji.
  async applyGeneration(id, generated) {
    const now = new Date().toISOString();
    if (this.publishedIds.has(id)) await this.#removePublication(id);
    const update = {
      title: generated.title || "",
      level1: generated.level1 || "",
      level2: generated.level2 || "",
      category: generated.category || "inne",
      tags: generated.tags || [],
      generation_status: generated.status,
      generation_reason: generated.reason,
      generation_model: generated.model || "",
      generation_basis_ids: generated.basisIds || [],
      originality: { ...generated.originality, validatedText: generated.originality?.valid ? generated.level1 : "" },
      context_originality: { ...generated.contextOriginality, validatedText: generated.contextOriginality?.valid ? generated.level2 : "" },
      metadata_validation: generated.metadataValidation,
      regenerated_at: now,
      editorial_updated_at: null,
      status: "review",
      approved_at: null,
      rejected_at: null,
      updated_at: now,
    };
    const { data, error } = await this.client.from("events").update(update).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(`Regeneracja materialu nie powiodla sie: ${error.message}`);
    return toEvent(data, this.publishedIds);
  }

  async setStatus(id, status) {
    if (!STATUSES.has(status) || status === "published") return null;
    const now = new Date().toISOString();
    if (this.publishedIds.has(id)) await this.#removePublication(id);
    const update = { status, updated_at: now };
    if (status === "approved") {
      update.approved_at = now;
      update.rejected_at = null;
    } else {
      update.approved_at = null;
      if (status === "rejected") update.rejected_at = now;
    }
    const { data, error } = await this.client.from("events").update(update).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(`Zmiana statusu nie powiodla sie: ${error.message}`);
    return toEvent(data, this.publishedIds);
  }

  async unpublish(id) {
    if (!this.publishedIds.has(id)) return this.getEvent(id);
    await this.#removePublication(id);
    const now = new Date().toISOString();
    const { data, error } = await this.client.from("events").update({ status: "review", approved_at: null, updated_at: now }).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(`Wycofanie publikacji nie powiodlo sie: ${error.message}`);
    return toEvent(data, this.publishedIds);
  }

  async publish(id) {
    const { data: event, error: fetchError } = await this.client.from("events").select("*").eq("id", id).maybeSingle();
    if (fetchError || !event || event.status !== "approved") return null;
    const now = new Date().toISOString();
    const reducedSources = (event.sources || []).map(({ domain, time, title, url }) => ({ domain, time, title, url }));
    const publicationRow = {
      id: event.id,
      title: event.title,
      image: event.image || null,
      level1: event.level1,
      level2: event.level2,
      category: event.category,
      tags: event.tags,
      confidence: event.confidence,
      sources: reducedSources,
      source_count: reducedSources.length,
      published_at: now,
      updated_at: now,
    };
    const { data: publicationData, error: publishError } = await this.client.from("publications").upsert(publicationRow, { onConflict: "id" }).select("*").maybeSingle();
    if (publishError) throw new Error(`Publikacja nie powiodla sie: ${publishError.message}`);
    await this.client.from("events").update({ status: "published", published_at: now, updated_at: now }).eq("id", id);
    this.publishedIds.add(id);
    return toPublication(publicationData);
  }

  // Zapisuje zmiane oceny jako roznice licznikow. Klient przysyla poprzedni
  // i nowy glos, wiec serwer nie musi znac tozsamosci glosujacego.
  async recordReaction(id, from, to) {
    if (!this.publishedIds.has(id)) return null;
    const { data: existing } = await this.client.from("reactions").select("*").eq("publication_id", id).maybeSingle();
    const counts = existing || { likes: 0, dislikes: 0 };
    const field = { like: "likes", dislike: "dislikes" };
    if (field[from]) counts[field[from]] = Math.max(0, (counts[field[from]] || 0) - 1);
    if (field[to]) counts[field[to]] = (counts[field[to]] || 0) + 1;
    const { data, error } = await this.client
      .from("reactions")
      .upsert({ publication_id: id, likes: counts.likes, dislikes: counts.dislikes }, { onConflict: "publication_id" })
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`Zapis oceny nie powiodl sie: ${error.message}`);
    return { likes: data.likes || 0, dislikes: data.dislikes || 0 };
  }

  async getReactionCounts() {
    const { data } = await this.client.from("reactions").select("*");
    return Object.fromEntries((data || []).map((row) => [row.publication_id, { likes: row.likes || 0, dislikes: row.dislikes || 0 }]));
  }

  async getReaction(id) {
    const { data } = await this.client.from("reactions").select("*").eq("publication_id", id).maybeSingle();
    return { likes: data?.likes || 0, dislikes: data?.dislikes || 0 };
  }

  async listPublications() {
    const { data, error } = await this.client.from("publications").select("*").order("published_at", { ascending: false });
    if (error) throw new Error(`Odczyt publikacji nie powiodl sie: ${error.message}`);
    return (data || []).map(toPublication);
  }

  async getPublication(id) {
    const { data, error } = await this.client.from("publications").select("*").eq("id", id).maybeSingle();
    if (error) return null;
    return toPublication(data);
  }

  // Sprawdza, czy podany adres obrazka faktycznie nalezy do jakiegos
  // wydarzenia lub publikacji w bazie. Uzywane przez proxy obrazkow, zeby
  // nie stac sie otwartym proxy dla dowolnego adresu https podanego przez klienta.
  async isKnownImageUrl(url) {
    const [events, publications] = await Promise.all([
      this.client.from("events").select("id").eq("image->>url", url).limit(1),
      this.client.from("publications").select("id").eq("image->>url", url).limit(1),
    ]);
    if (events.error || publications.error) return false;
    return Boolean(events.data?.length || publications.data?.length);
  }
}
