export interface SkynetConfig {
    debug: boolean;
    contract: string;
    actionIndex: string;
    deltaIndex: string;
}

export interface SkynetAPIRequestSearch {
    prompt?: string;
    model?: string;
}

export interface SkynetAPIRequestGetMetadata {
    cid: string;
}
