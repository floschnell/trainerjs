/**
 * a fitness trainer has to provide these information
 * to the simulator, so that it can update visuals accordingly
 */
export interface BikeTrainerData {
    readonly cadence: number;
    readonly speed: number;
    readonly power: number;
    readonly distance: number;
    readonly slope: number;
    readonly weight: number;
    readonly heart_rate: number;
    readonly break_temp: number;
}

/**
 * any new fitness trainer needs to implement this interface
 * so that the BikeSimulator can communicate with it.
 */
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