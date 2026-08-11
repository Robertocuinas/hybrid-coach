import { RerankProvider } from "../types.js";

/* Sin reranking: conserva el orden que trae la fusión RRF y recorta a topN.
   Existe para que el código de retrieval no tenga ni un `if (hayReranker)`
   (criterio de terminado de la Fase 7): el flujo es siempre el mismo, cambia
   el adaptador.

   Sus scores son POSICIONALES, no relevancia real: por eso declara
   scoresAbsolutos=false y el umbral RAG_MIN_SCORE se aplica entonces sobre la
   similitud coseno, que sí significa algo por sí sola. */
export class NoopRerankProvider extends RerankProvider {
  constructor() {
    super();
    this.provider = "noop";
  }

  capabilities() {
    return { scoresAbsolutos: false, maxDocuments: Infinity };
  }

  async rerank(_query, documents, topN = documents.length) {
    const limite = Math.max(0, Math.min(topN ?? documents.length, documents.length));
    return documents.slice(0, limite).map((_, index) => ({
      index,
      /* Decreciente y en (0,1] solo para que el campo tenga un valor coherente
         al depurar. No compares esto entre consultas. */
      score: 1 / (index + 1),
    }));
  }
}
