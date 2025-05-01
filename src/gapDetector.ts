// src/gapDetector.ts
import { Note } from './graphAnalyser';
import { LLMClient } from './lmmClient';

export class GapDetector {
  private graph: Map<string, Set<string>> = new Map();

  public analyseGraph(notes: Note[]): string[] {
    // Build graph adjacency list
    notes.forEach(note => {
      this.graph.set(note.id, new Set(note.links));
    });

    return this.findUnconnectedClusters();
  }

  private findUnconnectedClusters(): string[] {
    const visited = new Set<string>();
    const clusters: string[][] = [];
    const unconnectedNodes: string[] = [];

    // Find isolated nodes
    for (const [id, links] of this.graph.entries()) {
      if (links.size === 0) {
        unconnectedNodes.push(id);
      }
    }

    return unconnectedNodes;
  }

  // Add a method to find clusters (connected components)
  public findClusters(): string[][] {
    const visited = new Set<string>();
    const clusters: string[][] = [];

    for (const node of this.graph.keys()) {
      if (!visited.has(node)) {
        const cluster: string[] = [];
        this.dfs(node, visited, cluster);
        clusters.push(cluster);
      }
    }
    return clusters;
  }

  private dfs(node: string, visited: Set<string>, cluster: string[]) {
    if (visited.has(node)) return;
    visited.add(node);
    cluster.push(node);
    for (const neighbor of this.graph.get(node) ?? []) {
      this.dfs(neighbor, visited, cluster);
    }
  }

  public async clusterByEmbeddings(notes: Note[], llmClient: LLMClient, threshold = 0.5): Promise<string[][]> {
    // 1. Get embeddings for all notes
    const embeddings: { [id: string]: number[] } = {};
    for (const note of notes) {
      embeddings[note.id] = await llmClient.getEmbedding(note.content);
    }

    // 2. Agglomerative clustering (simple, not optimal for large N)
    const clusters: string[][] = [];
    const assigned = new Set<string>();

    for (const note of notes) {
      if (assigned.has(note.id)) continue;
      const cluster = [note.id];
      assigned.add(note.id);

      for (const other of notes) {
        if (note.id === other.id || assigned.has(other.id)) continue;
        const sim = cosineSimilarity(embeddings[note.id], embeddings[other.id]);
        if (sim >= threshold) {
          cluster.push(other.id);
          assigned.add(other.id);
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  public clusterByEmbeddingsCache(notes: Note[], embeddingsCache: Record<string, number[]>, threshold = 0.75): string[][] {
    const clusters: string[][] = [];
    const assigned = new Set<string>();

    for (const note of notes) {
        if (assigned.has(note.id)) continue;
        const cluster = [note.id];
        assigned.add(note.id);

        for (const other of notes) {
            if (note.id === other.id || assigned.has(other.id)) continue;
            const embA = embeddingsCache[note.id];
            const embB = embeddingsCache[other.id];
            if (!embA || !embB) continue;
            const sim = cosineSimilarity(embA, embB);
            if (sim >= threshold) {
                cluster.push(other.id);
                assigned.add(other.id);
            }
        }
        clusters.push(cluster);
    }
    return clusters;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return dot / (normA * normB);
}