export interface IGapFillerSettings {
    similarityThreshold: number;
    linkDistance: number;
    linkStrength: number;
    chargeStrength: number;
    centerStrength: number;
    useEmbeddings: boolean;
}

export class GapFillerSettings implements IGapFillerSettings {
    similarityThreshold: number = 0.85;
    linkDistance: number = 400;
    linkStrength: number = 1;
    chargeStrength: number = -400;
    centerStrength: number = 1;
    useEmbeddings: boolean = false;

}