import { Plugin } from 'obsidian';

export default class KGGapFiller extends Plugin {
    async onload() {
        console.log('KGGapFiller plugin loaded');

        // Example: Add a command to your plugin
        this.addCommand({
            id: 'fill-gap',
            name: 'Fill Gap',
            callback: () => {
                alert('Filling gap!');
            }
        });
    }

    onUnload() {
        console.log('KGGapFiller plugin unloaded');
    }
}