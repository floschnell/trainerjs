declare module "gpxparser";

interface Distance {
    total: number;
    cumul: number;
}

interface Point {
    lat: number;
    lon: number;
    ele: number;
    time: Date;
}

interface Track {
    total: number;
    slopes: number[];
    points: Point[];
    distance: Distance;
}

declare class gpxParser {
    constructor();
    parse(data: string): void;
    tracks: Track[];
}
