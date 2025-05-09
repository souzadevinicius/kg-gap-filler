import * as path from 'path';
const fs = require('fs').promises;

export class FileUtils {


    public async createFolder(folders: string[]) {
        for (const folder of folders) {
            const dir = path.dirname(folder);
            console.log('creating', folder);
            await fs.mkdir(folder, { recursive: true }); // Create directories if they don't exist
        }
    }

    public safeStringify(obj: object) {
        const seen = new WeakSet();
        return JSON.stringify(obj, (key, value) => {
            if (typeof value === "object" && value !== null) {
                if (seen.has(value)) return;
                seen.add(value);
            }
            return value;
        });
    }
}