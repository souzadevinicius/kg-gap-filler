import { App, TFile, Notice } from 'obsidian';
import * as path from 'path';
const fs = require('fs').promises;

import { GapDetector } from './gapDetector';
import { Note } from './graphAnalyser';
import { LLMClient } from './lmmClient';
import { GapFillerSettings } from './settings';

export class EmbeddingUtils {
    private app: App;
    private embeddingsCache: Record<string, number[]> = {};
    private llmClient: LLMClient = new LLMClient('http://localhost:1234/v1/chat/completions');
    private detector: GapDetector;
    private settings: GapFillerSettings;
    private embeddingPath: string = './embeddings/'

    constructor(app: App, settings: GapFillerSettings) {
        this.app = app;
        this.detector = new GapDetector();
        this.settings = settings
    }

    public async getClusterByEmbedding(notes: Note[], filePath: string, depth: number = 1) {
        // Use embeddings to build connections
        this.embeddingsCache = await this.loadEmbeddingsFromFile();
        // Find the active note
        const activeNote = notes.find(n => n.filePath === filePath);

        if (!activeNote) {
            new Notice("Active note not found in notes array.");
            return { "clusters": [], "shallowNotes": [], "shallowLinks": [] };
        }
        // Collect nodes up to the given depth using semantic similarity
        let currentLevel = new Set<string>([activeNote.id]);
        let allIncluded = new Set<string>([activeNote.id]);
        for (let d = 0; d < depth; d++) {
            const nextLevel = new Set<string>();
            for (const id of currentLevel) {
                const embA = this.embeddingsCache[id];
                if (!embA) continue;
                for (const n of notes) {
                    if (allIncluded.has(n.id)) continue;
                    const embB = this.embeddingsCache[n.id];
                    if (!embB) continue;
                    const sim = this.detector.cosineSimilarity(embA, embB);
                    if (sim >= this.settings.similarityThreshold) {
                        nextLevel.add(n.id);
                    }
                }
            }
            nextLevel.forEach(id => allIncluded.add(id));
            currentLevel = nextLevel;
        }
        let shallowNotes = notes.filter(n => allIncluded.has(n.id));
        let shallowLinks = [];
        for (const a of shallowNotes) {
            for (const b of shallowNotes) {
                if (a.id !== b.id) {
                    const embA = this.embeddingsCache[a.id];
                    const embB = this.embeddingsCache[b.id];
                    if (embA && embB && this.detector.cosineSimilarity(embA, embB) >= this.settings.similarityThreshold) {
                        shallowLinks.push([a.id, b.id]);
                    }
                }
            }
        }
        return {
            "clusters": this.detector.clusterByEmbeddingsCache(shallowNotes, this.embeddingsCache, this.settings.similarityThreshold),
            "shallowNotes": shallowNotes,
            "shallowLinks": shallowLinks

        }

    }


    private async loadEmbeddingsFromFile(fileName = 'embeddings-cache.json'): Promise<Record<string, number[]>> {
        if (Object.keys(this.embeddingsCache).length > 0) {
            // Return cached embeddings if already loaded
            return this.embeddingsCache;
        }
        try {
            const content = await this.app.vault.adapter.read(path.join(this.embeddingPath, fileName));
            this.embeddingsCache = JSON.parse(content);
            return this.embeddingsCache;
        } catch {
            return {};
        }
    }


    public async reindexEmbeddings() {
        new Notice("Embeddings reindex started.");
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            const content = await this.app.vault.read(file);
            const embedding = await this.llmClient.getEmbedding(content);
            this.embeddingsCache[file.basename] = embedding;
        }
        await this.saveEmbeddingsToFile(this.embeddingsCache);
        new Notice("Embeddings reindexed for all notes.");
    }

    private async saveEmbeddingsToFile(embeddings: Record<string, number[]>, fileName = 'embeddings-cache.json') {
        const content = JSON.stringify(embeddings);
        try {
            // Ensure the directory exists
            const fpath = path.join(this.embeddingPath, fileName);
            await this.app.vault.adapter.write(fpath, content);
            new Notice(`Embeddings saved to ${fileName}`);
        } catch (err) {
            console.error(err);
            new Notice(`Failed to save embeddings: ${err}`);
        }
    }

}