// src/gapDetector.ts
import { Note } from './graphAnalyser';
import { LLMClient } from './lmmClient';

export class GapDetector {
  private graph: Map<string, Set<string>> = new Map();

  public analyseGraph(notes: Note[]): { clusters: string[][], unconnectedNodes: string[] } {
    // Build graph adjacency list (assuming undirected graph)
    this.graph.clear(); // Clear previous data if any
    notes.forEach(note => {
      // Initialize each node if not already present
      if (!this.graph.has(note.id)) {
        this.graph.set(note.id, new Set());
      }
      // Add links (both directions for undirected graph)
      note.links.forEach(link => {
        this.graph.get(note.id)?.add(link);
        // Ensure the linked node exists in the graph
        if (!this.graph.has(link)) {
          this.graph.set(link, new Set());
        }
        this.graph.get(link)?.add(note.id);
      });
    });

    const clusters = this.findClusters();
    const unconnectedNodes = this.findUnconnectedNodes();

    return { clusters, unconnectedNodes };
  }

  public findClustersFromSubgraph(notes: Note[]): string[][] {
    // Build a temporary graph just for these notes
    const graph = new Map<string, Set<string>>();
    notes.forEach(note => {
      graph.set(note.id, new Set(note.links.filter(l =>
        notes.some(n => n.id === l) // Only keep links that exist in our subset
      )));
    });

    // Standard DFS cluster detection
    const visited = new Set<string>();
    const clusters: string[][] = [];

    for (const note of notes) {
      if (!visited.has(note.id)) {
        const cluster: string[] = [];
        this.dfsSubgraph(note.id, graph, visited, cluster);
        clusters.push(cluster);
      }
    }

    return clusters;
  }

  private findUnconnectedNodes(): string[] {
    const unconnectedNodes: string[] = [];
    for (const [id, links] of this.graph.entries()) {
      if (links.size === 0) {
        unconnectedNodes.push(id);
      }
    }
    return unconnectedNodes;
  }

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

  private dfsSubgraph(node: string, graph: Map<string, Set<string>>, visited: Set<string>, cluster: string[]) {
    if (visited.has(node)) return;
    visited.add(node);
    cluster.push(node);

    for (const neighbor of graph.get(node) || []) {
      this.dfsSubgraph(neighbor, graph, visited, cluster);
    }
  }

  // public async clusterByEmbeddings(notes: Note[], llmClient: LLMClient, threshold = 0.5): Promise<string[][]> {
  //   // 1. Get embeddings for all notes
  //   const embeddings: { [id: string]: number[] } = {};
  //   for (const note of notes) {
  //     embeddings[note.id] = await llmClient.getEmbedding(note.content);
  //   }

  //   // 2. Agglomerative clustering (simple, not optimal for large N)
  //   const clusters: string[][] = [];
  //   const assigned = new Set<string>();

  //   for (const note of notes) {
  //     if (assigned.has(note.id)) continue;
  //     const cluster = [note.id];
  //     assigned.add(note.id);

  //     for (const other of notes) {
  //       if (note.id === other.id || assigned.has(other.id)) continue;
  //       const sim = this.cosineSimilarity(embeddings[note.id], embeddings[other.id]);
  //       if (sim >= threshold) {
  //         cluster.push(other.id);
  //         assigned.add(other.id);
  //       }
  //     }
  //     clusters.push(cluster);
  //   }
  //   return clusters;
  // }

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
        const sim = this.cosineSimilarity(embA, embB);
        if (sim >= threshold) {
          cluster.push(other.id);
          assigned.add(other.id);
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }



  public cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dot / (normA * normB);
  }
}
