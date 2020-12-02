import { BikeTrainer, BikeTrainerData } from "../BikeTrainer";

export class TestTrainer implements BikeTrainer {

    private data: BikeTrainerData;

    constructor() {
        this.data = <BikeTrainerData>{
            cadence: 0,
            distance: 0,
            power: 0,
            slope: 0,
            speed: 0,
            weight: 0,
        };

        window.onkeydown = (event: KeyboardEvent) => {
            const oldSpeed = this.data.speed;
            switch (event.key) {
                case "Left":
                case "ArrowLeft":
                    this.onButtonLeft();
                    break;

                case "Right":
                case "ArrowRight":
                    this.onButtonRight();
                    break;

                case "Down":
                case "ArrowDown":
                    this.onButtonDown();
                    break;
                
                case "Up":
                case "ArrowUp":
                    this.onButtonUp();
                    break;

                case "+":
                    this.data = {
                        ...this.data,
                        speed: this.data.speed + 5,
                    };
                    if (oldSpeed === 0 && this.data.speed > 0) {
                        this.onResumed();
                    }
                    if (this.data.speed != oldSpeed) this.onDataUpdated(this.data);
                    break;
                    
                case "-":
                    this.data = {
                        ...this.data,
                        speed: this.data.speed >= 5 ? this.data.speed - 5 : 0,
                    };
                    if (oldSpeed > 0 && this.data.speed === 0) {
                        this.onPaused();
                    }
                    if (this.data.speed != oldSpeed) this.onDataUpdated(this.data);
                    break;
            }
        };
    }

    connect(): Promise<void> {
        return Promise.resolve();
    }

    disconnect(): Promise<void> {
        return Promise.resolve();
    }

    startWorkout(): Promise<void> {

        window.setInterval(() => {
            const oldDistance = this.data.distance;
            this.data = {
                ...this.data,
                cadence: 40 + Math.random() * 10,
                power: Math.max(0, this.data.speed * 2.5 + this.data.speed * this.data.slope),
                distance: this.data.distance + this.data.speed / 3.6,
            };
            if (oldDistance != this.data.distance) {
                this.onDistanceUpdated(this.data.distance);
            }
            this.onDataUpdated(this.data);
        }, 1000);

        return Promise.resolve();
    }

    getData(): BikeTrainerData {
        return this.data;
    }

    isPaused(): boolean {
        return this.data.speed === 0;
    }

    setSlope(slope: number): void {
        this.data = {
            ...this.data,
            slope,
        };
    }

    onPaused: () => void;
    onResumed: () => void;
    onDataUpdated: (data: BikeTrainerData) => void;
    onDistanceUpdated: (distance: number) => void;
    onButtonLeft: () => void;
    onButtonDown: () => void;
    onButtonOK: () => void;
    onButtonUp: () => void;
    onButtonRight: () => void;

}