// src/main.ts

import { GraphAnalyser } from './graphAnalyser';
import { GapDetector } from './gapDetector';
import { LLMClient } from './lmmClient';
import { GraphViewer } from './graphViewer';
import { Note } from './graphAnalyser';
import { Plugin, TFile, Notice, MarkdownView, App, PluginSettingTab, Setting } from 'obsidian';

interface GapFillerSettings {
    similarityThreshold: number;
}

const DEFAULT_SETTINGS: GapFillerSettings = {
    similarityThreshold: 0.6,
};

export default class KGGapFiller extends Plugin {
    settings!: GapFillerSettings;
    private analyser!: GraphAnalyser;
    private detector!: GapDetector;
    private llmClient!: LLMClient;
    private viewer!: GraphViewer;
    private container!: HTMLElement;
    private embeddingsCache: Record<string, number[]> = {};
    private latestFile?: Note;

    // Helper: robustly get the last active Markdown file
    private getCurrentMarkdownFile(app: App): TFile | null {
        const leaf = app.workspace.getMostRecentLeaf();
        if (leaf && leaf.view instanceof MarkdownView) {
            return leaf.view.file;
        }
        return app.workspace.getActiveFile(); // Reset if no valid file found
    }

    async onload() {
        console.log('KGGapFiller plugin loaded');
        this.analyser = new GraphAnalyser();
        this.detector = new GapDetector();
        this.llmClient = new LLMClient('http://localhost:1234/v1/chat/completions');
        this.viewer = new GraphViewer("graph-container");
        this.container = await this.createContainer();
        this.viewer.setContainer(this.container);
        this.addRibbonIcon('dot-network', 'Show D3 Graph', async () => {
            // Remove any previous container from the DOM (cleanup)
            const old = document.getElementById('graph-container');
            if (old && old.parentElement) old.parentElement.removeChild(old);

            // Create a fresh container
            const container = this.createContainer();

            // Try to find an existing right leaf with our container
            let leaf = this.app.workspace.getRightLeaf(false);
            let found = false;
            if (leaf && leaf.view.containerEl.querySelector('#graph-container')) {
                // Already open, just update content
                leaf.view.containerEl.empty();
                leaf.view.containerEl.appendChild(container);
                found = true;
            }

            if (!found) {
                // Attach to the right pane, or fallback to body
                if (leaf) {
                    await leaf.setViewState({ type: "empty", active: true });
                    leaf.view.containerEl.empty();
                    leaf.view.containerEl.appendChild(container);
                } else {
                    document.body.appendChild(container);
                    console.warn('Using body container as fallback');
                }
            }

            // Set the container for the viewer
            this.viewer.setContainer(container);

            // Get the currently active file robustly
            const activeFile = this.getCurrentMarkdownFile(this.app);
            if (!activeFile) {
                new Notice("No active file found. Please focus a note and try again.");
                return;
            }

            // Run analysis only for the current file
            await this.run(activeFile, 1);
        });

        this.addCommand({
            id: 'fill-gap-bridges',
            name: 'Fill Gaps Using Bridges',
            callback: () => this.run(this.getCurrentMarkdownFile(this.app))
        });

        // Watch for new or modified markdown files and update the graph if the container is visible
        this.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    await this.run(this.getCurrentMarkdownFile(this.app));
                }
            })
        );
        this.registerEvent(
            this.app.workspace.on('file-open', async (file) => {
                await this.run(this.getCurrentMarkdownFile(this.app));
            })
        );

        this.registerEvent(
            this.app.vault.on('modify', async (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    await this.run(this.getCurrentMarkdownFile(this.app));
                }
            })
        );

        this.addCommand({
            id: 'reindex-embeddings',
            name: 'Reindex Note Embeddings',
            callback: () => this.reindexEmbeddings()
        });

        // Add settings tab
        this.addSettingTab(new GapFillerSettingTab(this.app, this));

        await this.loadSettings();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private createContainer(): HTMLElement {
        // Always create a new div for the container
        const container = document.createElement('div');
        container.id = 'graph-container';
        container.style.height = '100%';
        container.style.width = '100%';
        container.createEl('div', { attr: { id: 'd3-graph-container' } });
        return container;
    }

    public async run(file: TFile | null, depth: number = 1, useEmbeddings: boolean = true): Promise<void> {
        if (!file) {
            new Notice("No active file found.");
            return;
        }


        // Build notes array as before
        const files = this.app.vault.getMarkdownFiles();
        const notes: Note[] = [];
        for (const file of files) {
            const content = await this.app.vault.read(file);
            notes.push({
                id: file.basename,
                title: file.basename,
                file: file,
                content,
                links: this.analyser['extractLinks'](content)
            });
        }

        const activeNote = notes.find(n => n.file && file && n.file.path === file.path);
        if (this.latestFile && this.latestFile.id === activeNote?.id) {
            return;
        }


        this.embeddingsCache = await this.loadEmbeddingsFromFile();

        // Find the active note
        if (!activeNote) {
            new Notice("Active note not found in notes array.");
            return;
        }

        let shallowNotes: Note[] = [];
        let shallowLinks: string[][] = [];

        if (useEmbeddings) {
            // Use embeddings to build connections
            this.embeddingsCache = await this.loadEmbeddingsFromFile();
            // Find the active note
            const activeNote = notes.find(n => n.file && file && n.file.path === file.path);
            if (!activeNote) {
                new Notice("Active note not found in notes array.");
                return;
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
                        // Use a similarity threshold (e.g., 0.75)
                        const sim = this.detector.cosineSimilarity(embA, embB);
                        if (sim >= this.settings.similarityThreshold) {
                            nextLevel.add(n.id);
                        }
                    }
                }
                nextLevel.forEach(id => allIncluded.add(id));
                currentLevel = nextLevel;
            }
            shallowNotes = notes.filter(n => allIncluded.has(n.id));
            // Build links based on semantic similarity
            shallowLinks = [];
            for (const a of shallowNotes) {
                for (const b of shallowNotes) {
                    if (a.id !== b.id) {
                        const embA = this.embeddingsCache[a.id];
                        const embB = this.embeddingsCache[b.id];
                        if (embA && embB && this.detector.cosineSimilarity(embA, embB) >= 0.75) {
                            shallowLinks.push([a.id, b.id]);
                        }
                    }
                }
            }
        } else {
            // Use concrete links as before
            const activeNote = notes.find(n => n.file && file && n.file.path === file.path);
            if (!activeNote) {
                new Notice("Active note not found in notes array.");
                return;
            }
            let currentLevel = new Set<string>([activeNote.id]);
            let allIncluded = new Set<string>([activeNote.id]);
            for (let d = 0; d < depth; d++) {
                const nextLevel = new Set<string>();
                for (const id of currentLevel) {
                    const node = notes.find(n => n.id === id);
                    if (!node) continue;
                    // Outgoing
                    node.links.forEach(l => {
                        if (!allIncluded.has(l)) nextLevel.add(l);
                    });
                    // Incoming
                    notes.forEach(n => {
                        if (n.links && n.links.includes(node.title) && !allIncluded.has(n.id)) {
                            nextLevel.add(n.id);
                        }
                    });
                }
                nextLevel.forEach(id => allIncluded.add(id));
                currentLevel = nextLevel;
            }
            shallowNotes = notes.filter(n => allIncluded.has(n.id) || (n.isBridge && n.links.some(l => allIncluded.has(l))));
            shallowLinks = this.buildLinks(shallowNotes);
        }


        // For a single file, you may want to analyze the whole vault for clusters
        const clusters = this.detector.clusterByEmbeddingsCache(shallowNotes, this.embeddingsCache, 0.75);
        console.log(`Clusters found: ${clusters.length}`);
        console.log(`shallowNotes found: ${shallowNotes.length}`);
        console.log(`shallowLinks found: ${shallowLinks.length}`);
        // this.detector.analyseGraph(notes); // Build the graph
        this.viewer.drawGraph(shallowNotes, shallowLinks);
        const topicsSearched : string[] = [];
        this.latestFile = activeNote
        if (clusters.length > 1) {
            for (let i = 0; i < clusters.length; i++) {
                for (let j = i + 1; j < clusters.length; j++) {
                    const clusterA = clusters[i].map(id => notes.find(n => n.id === id)?.title).filter(Boolean).join(', ');
                    const clusterB = clusters[j].map(id => notes.find(n => n.id === id)?.title).filter(Boolean).join(', ');

                    // Pick representative notes from each cluster (first note in each cluster)
                    const repA = notes.find(n => n.id === clusters[i][0]);
                    const repB = notes.find(n => n.id === clusters[j][0]);

                    if (clusterA.length > 0 && clusterB.length > 0 && repA && repB) {
                        if (topicsSearched.includes(clusterA) && topicsSearched.includes(clusterB)) {
                            continue;
                        }
                        topicsSearched.push(clusterA, clusterB);
                        const prompt = `Given the topics: [${clusterA}] and [${clusterB}], suggest the two (and only two) most relevant topics, or entity that could serve as a bridge between these two clusters.
                        Return ONLY the bridge topic as the first line, a one-sentence summary as the second line, and a Wikipedia URL about that topic as the third line.
                        If no meaningful bridge exists, reply with "NO BRIDGE".`;

                        const bridge = await this.llmClient.generateContent(prompt);

                        // Parse the LLM response
                        let [bridgeTopic, bridgeSummary, wikiUrl] = bridge.trim().split('\n').map(s => s.trim());

                        if (
                            bridgeTopic &&
                            bridgeTopic.toUpperCase() !== "NO BRIDGE" &&
                            bridgeTopic.length > 3 &&
                            wikiUrl && wikiUrl.includes("http")
                        ) {
                            wikiUrl = `https://${wikiUrl.split("//")[1]}`;
                            shallowNotes.push({
                                id: bridgeTopic,
                                title: bridgeTopic.replace(/\*\*Bridge Topic:\*\*/g, ' '),
                                file: repA.file, // Use repA's file as a placeholder
                                content: bridgeSummary,
                                links: [repA.title, repB.title].filter(Boolean),
                                isBridge: true,
                                wikiUrl,
                                summary: bridgeSummary
                            });
                            console.log(wikiUrl)
                            shallowLinks = this.buildLinks(shallowNotes);
                            this.viewer.drawGraph(shallowNotes, shallowLinks);
                        }
                    } else {
                        new Notice(`Empty cluster found, skipping. {clusterA: ${clusterA}, clusterB: ${clusterB}}`);
                    }

                    console.log(`$clusters found: ${clusterA}, ${clusterB}`);
                    new Notice("Bridge notes created (if any meaningful bridges were found).");
                }
            }
        } else {
            new Notice("No clusters found or only one cluster present.");
        }

    }

    private buildLinks(notes: Note[]): string[][] {
        const noteIds = new Set(notes.map(n => n.id));
        const links: string[][] = [];
        for (const note of notes) {
            for (const link of note.links) {
                if (noteIds.has(link)) {
                    links.push([note.id, link]);
                }
            }
        }
        return links;
    }

    public async reindexEmbeddings() {
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
        const filePath = `${fileName}`;
        const content = JSON.stringify(embeddings);
        // Check if file exists
        let file = this.app.vault.getAbstractFileByPath(filePath);
        if (file) {
            await this.app.vault.modify(file as TFile, content);
        } else {
            await this.app.vault.create(filePath, content);
        }
        new Notice(`Embeddings saved to ${filePath}`);
    }

    private async loadEmbeddingsFromFile(fileName = 'embeddings-cache.json'): Promise<Record<string, number[]>> {
        const filePath = `${fileName}`;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file) return {};
        const content = await this.app.vault.read(file as TFile);
        try {
            return JSON.parse(content);
        } catch {
            return {};
        }
    }
}

class GapFillerSettingTab extends PluginSettingTab {
    plugin: KGGapFiller;

    constructor(app: App, plugin: KGGapFiller) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Similarity Threshold')
            .setDesc('Minimum cosine similarity for semantic connections (0.0 - 1.0)')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.01)
                .setValue(this.plugin.settings.similarityThreshold)
                .onChange(async (value) => {
                    this.plugin.settings.similarityThreshold = value;
                    await this.plugin.saveSettings();
                })
                .setDynamicTooltip()
            );
    }
}
