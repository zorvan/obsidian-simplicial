import type { InferenceContext } from "./inference/types";

export interface ClusteringConfig {
  k: number;
  minClusterSize: number;
  maxIterations: number;
}

export const DEFAULT_CLUSTERING_CONFIG: ClusteringConfig = {
  k: 8,
  minClusterSize: 3,
  maxIterations: 100,
};

interface DocumentVector {
  path: string;
  vector: Map<string, number>;
  magnitude: number;
}

/**
 * Build TF-IDF vectors for all documents and cluster them using k-means.
 * Returns a map from path to cluster ID.
 */
export function clusterByContent(
  contexts: InferenceContext[],
  config: Partial<ClusteringConfig> = {},
): Map<string, string> {
  const fullConfig = { ...DEFAULT_CLUSTERING_CONFIG, ...config };
  
  if (contexts.length < fullConfig.minClusterSize) {
    return new Map(contexts.map(c => [c.path, "default"]));
  }

  const k = Math.min(fullConfig.k, Math.floor(contexts.length / fullConfig.minClusterSize));
  if (k < 2) {
    return new Map(contexts.map(c => [c.path, "default"]));
  }

  const vectors = buildTFIDFVectors(contexts);
  const clusters = kMeans(vectors, k, fullConfig.maxIterations);
  
  return new Map(clusters.map((clusterId, i) => [vectors[i].path, `cluster-${clusterId}`]));
}

function buildTFIDFVectors(contexts: InferenceContext[]): DocumentVector[] {
  const docCount = contexts.length;
  const termDocFreq = new Map<string, number>();
  const docVectors: Map<string, number>[] = [];

  for (const ctx of contexts) {
    const termFreq = new Map<string, number>();
    
    for (const token of ctx.titleTokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 3);
    }
    
    for (const token of ctx.contentTokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }
    
    for (const tag of ctx.tags) {
      const tagToken = tag.replace(/^#/, "");
      termFreq.set(tagToken, (termFreq.get(tagToken) ?? 0) + 5);
    }

    for (const term of termFreq.keys()) {
      termDocFreq.set(term, (termDocFreq.get(term) ?? 0) + 1);
    }
    
    docVectors.push(termFreq);
  }

  const idf = new Map<string, number>();
  for (const [term, docFreq] of termDocFreq) {
    idf.set(term, Math.log(docCount / (docFreq + 1)) + 1);
  }

  return contexts.map((ctx, i) => {
    const tf = docVectors[i];
    const vector = new Map<string, number>();
    let magnitude = 0;

    for (const [term, freq] of tf) {
      const tfidf = freq * (idf.get(term) ?? 1);
      vector.set(term, tfidf);
      magnitude += tfidf * tfidf;
    }

    return {
      path: ctx.path,
      vector,
      magnitude: Math.sqrt(magnitude),
    };
  });
}

function cosineSimilarity(a: DocumentVector, b: DocumentVector): number {
  if (a.magnitude === 0 || b.magnitude === 0) return 0;
  
  let dotProduct = 0;
  for (const [term, valueA] of a.vector) {
    const valueB = b.vector.get(term);
    if (valueB !== undefined) {
      dotProduct += valueA * valueB;
    }
  }
  
  return dotProduct / (a.magnitude * b.magnitude);
}

function kMeans(vectors: DocumentVector[], k: number, maxIterations: number): number[] {
  const n = vectors.length;
  const assignments = new Array(n).fill(0).map(() => Math.floor(Math.random() * k));
  const centroids: Map<string, number>[] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    for (let c = 0; c < k; c++) {
      const clusterDocs = vectors.filter((_, i) => assignments[i] === c);
      if (clusterDocs.length === 0) {
        centroids[c] = new Map(vectors[Math.floor(Math.random() * n)].vector);
        continue;
      }

      const centroid = new Map<string, number>();
      const termCounts = new Map<string, number>();
      
      for (const doc of clusterDocs) {
        for (const [term, value] of doc.vector) {
          termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
          centroid.set(term, (centroid.get(term) ?? 0) + value);
        }
      }

      for (const [term, sum] of centroid) {
        centroid.set(term, sum / clusterDocs.length);
      }
      
      centroids[c] = centroid;
    }

    let changed = false;
    for (let i = 0; i < n; i++) {
      const vector = vectors[i];
      let bestCluster = 0;
      let bestSimilarity = -1;

      for (let c = 0; c < k; c++) {
        const centroidVec: DocumentVector = {
          path: `centroid-${c}`,
          vector: centroids[c],
          magnitude: Math.sqrt([...centroids[c].values()].reduce((a, b) => a + b * b, 0)),
        };
        
        const similarity = cosineSimilarity(vector, centroidVec);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestCluster = c;
        }
      }

      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    if (!changed) break;
  }

  return assignments;
}

/**
 * Hybrid domain assignment that uses content clustering as primary source
 * with folder as fallback for small or ambiguous clusters.
 */
export function assignHybridDomains(
  contexts: InferenceContext[],
  contentClusters: Map<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  
  for (const ctx of contexts) {
    const contentDomain = contentClusters.get(ctx.path);
    
    if (!contentDomain || contentDomain === "default") {
      result.set(ctx.path, ctx.topFolder || ctx.folder || "misc");
    } else {
      result.set(ctx.path, contentDomain);
    }
  }
  
  return result;
}
