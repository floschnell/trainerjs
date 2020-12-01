export interface BikeTrainerData {
    cadence: number;
    speed: number;
    power: number;
    distance: number;
    slope: number;
    weight: number;
}

export interface BikeTrainer {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    startWorkout(): Promise<void>;
    getData(): BikeTrainerData;
    isPaused(): boolean;
    setSlope(slope: number): void;

    // state handling
    onPaused: () => void;
    onResumed: () => void;

    // data updates
    onDataUpdated: (data: BikeTrainerData) => void;
    onDistanceUpdated: (distance: number) => void;

    // button handling
    onButtonLeft: () => void;
    onButtonDown: () => void;
    onButtonOK: () => void;
    onButtonUp: () => void;
    onButtonRight: () => void;
}