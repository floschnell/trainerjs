import * as Cesium from "cesium";
import * as Chart from "chart.js";
import * as gpxParser from "gpxparser";
import { MathHelpers } from "./MathHelpers";
import { ChartPoint } from "chart.js";
import { BikeTrainer, BikeTrainerData } from "./BikeTrainer";
import { padStart } from 'lodash';
import { buildGPX, StravaBuilder } from 'gpx-builder';
import { Segment, Track } from "gpx-builder/dist/builder/BaseBuilder/models";
const { Point } = StravaBuilder.MODELS;

const CHART_METRICS = [
    {
        id: "speed",
        color: "green",
        datasetIndex: 1,
    },
    {
        id: "cadence",
        color: "blue",
        datasetIndex: 2,
    },
    {
        id: "power",
        color: "red",
        datasetIndex: 3,
    },
    {
        id: "heart_rate",
        color: "purple",
        datasetIndex: 4,
    },
];


function download(filename: string, json: string): void {
    const element = document.createElement("a");
    element.setAttribute(
        "href",
        "data:application/xml;charset=utf-8," + encodeURIComponent(json)
    );
    element.setAttribute("download", filename);

    element.style.display = "none";
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
}


interface SmoothedSegment {
    distance: number,
    slope: number,
    elevation: number,
    lat: number,
    lng: number,
}

interface Recording extends BikeTrainerData {
    time: number,
}


interface RiderPosition {
    latitude: number;
    longitude: number;
    elevation: number;
}


export class BikeSimulator {
    private static MAX_SLOPE_CHANGE = 1.0;

    private cameraRotation: number = 0;
    private offset: number = 0;
    private player: any = null;
    private cesiumViewer: any = null;
    private smoothedSegments: SmoothedSegment[] = [];
    private progressedDistance: number = 0;
    private subprogress: number = 0;
    private lastRender: number = performance.now();
    private bikeTrainer: BikeTrainer = null;
    private recording: Recording[] = [];
    private activeChartMetric: number = 1;
    private chart: Chart = null;
    private previewChart: Chart = null;
    private gpx: gpxParser = null;

    private gpxFileInput: HTMLInputElement = null;
    private overlayElement: HTMLElement = null;
    private gameElement: HTMLElement = null;
    private initElement: HTMLElement = null;
    private startElement: HTMLElement = null;
    private startWorkoutButton: HTMLButtonElement = null;
    private pauseElement: HTMLElement = null;
    private overlayPausedElement: HTMLElement = null;

    constructor(bikeTrainer: BikeTrainer, {
        gpxFileInputId,
        overlayElementId,
        gameElementId,
        initElementId,
        startElementId,
        pauseElementId,
        forwardButtonId,
        rewindButtonId,
        startButtonId,
    }) {
        this.cameraRotation = 0;
        this.offset = 0;
        this.player = null;
        this.cesiumViewer = null;
        this.smoothedSegments = [];
        this.progressedDistance = 0;
        this.subprogress = 0;
        this.lastRender = performance.now();
        this.bikeTrainer = bikeTrainer;
        this.recording = [];
        this.activeChartMetric = 1;
        this.gpx = null;

        if (this.bikeTrainer != null) {
            this.bikeTrainer.onDataUpdated = this.onDataUpdated.bind(this);
            this.bikeTrainer.onPaused = this.onPaused.bind(this);
            this.bikeTrainer.onResumed = this.onResumed.bind(this);
            this.bikeTrainer.onDistanceUpdated = this.onDistanceUpdated.bind(this);
            this.bikeTrainer.onButtonDown = this.onButtonDown.bind(this);
            this.bikeTrainer.onButtonUp = this.onButtonUp.bind(this);
            this.bikeTrainer.onButtonRight = this.onButtonRight.bind(this);
            this.bikeTrainer.onButtonLeft = this.onButtonLeft.bind(this);
        }

        this.gpxFileInput = document.getElementById(gpxFileInputId) as HTMLInputElement;
        this.overlayElement = document.getElementById(overlayElementId);
        this.gameElement = document.getElementById(gameElementId);
        this.initElement = document.getElementById(initElementId);
        this.startElement = document.getElementById(startElementId);
        this.pauseElement = document.getElementById(pauseElementId);
        this.overlayPausedElement = document.getElementById("overlay-paused");
        this.startWorkoutButton = document.getElementById(startButtonId) as HTMLButtonElement;

        this.gpxFileInput.onchange = () => this.prepare();

        document.getElementById(forwardButtonId).onclick = () => this.seek(1000);
        document.getElementById(rewindButtonId).onclick = () => this.seek(-1000);

        this.startWorkoutButton.onclick = () => this.start();

        this.chart = new Chart("chart", {
            type: 'line',
            data: {
                datasets: [{
                    label: "Elevation (m)",
                    data: [],
                    borderColor: 'grey',
                    yAxisID: 'y-axis-elevation',
                },
                {
                    label: "Speed (km/h)",
                    data: [],
                    borderColor: 'green',
                    fill: false,
                    yAxisID: 'y-axis-metrics',
                },
                {
                    label: "Cadence (rpm)",
                    data: [],
                    borderColor: 'blue',
                    fill: false,
                    yAxisID: 'y-axis-metrics',
                },
                {
                    label: "Power (Watts)",
                    data: [],
                    borderColor: 'red',
                    fill: false,
                    yAxisID: 'y-axis-metrics',
                },
                {
                    label: "Heart Rate (bpm)",
                    data: [],
                    borderColor: 'purple',
                    fill: false,
                    yAxisID: 'y-axis-metrics',
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    xAxes: [{
                        type: 'linear',
                        position: 'bottom',
                        ticks: {
                            min: 0,
                            max: 1000,
                        },
                    }],
                    yAxes: [{
                        type: 'linear', // only linear but allow scale type registration. This allows extensions to exist solely for log scale for instance
                        display: true,
                        position: 'left',
                        id: 'y-axis-elevation',
                    }, {
                        type: 'linear', // only linear but allow scale type registration. This allows extensions to exist solely for log scale for instance
                        display: true,
                        position: 'right',
                        id: 'y-axis-metrics',
                        ticks: {
                            beginAtZero: true,
                        },

                        // grid line settings
                        gridLines: {
                            drawOnChartArea: false, // only want the grid lines for one axis to show up
                        },
                    }],
                },
            },
        });
    }

    public onButtonDown() {
        this.activeChartMetric = this.activeChartMetric == 1 ? CHART_METRICS.length : this.activeChartMetric - 1;
        this.drawChart();
    }

    public onButtonUp() {
        this.activeChartMetric = this.activeChartMetric == CHART_METRICS.length ? 1 : this.activeChartMetric + 1;
        this.drawChart();
    }

    public onButtonLeft() {
        this.seek(-1000);
    }

    public onButtonRight() {
        this.seek(1000);
    }

    public export(): void {
        const lines: [number, number, number, Recording][] = this.recording.map((entry) => {
            const pos = this.getPosByDistance(entry.distance);
            return [pos.longitude, pos.latitude, pos.elevation, entry];
        });
        const now = new Date();
        const date = `${now.getFullYear()}-${padStart(now.getMonth() + 1, 2, '0')}-${padStart(now.getDate(), 2, '0')}_${padStart(now.getHours(), 2, '0')}-${padStart(now.getMinutes(), 2, '0')}`
        download(`${this.gpxFileInput.files[0].name.split('.').slice(0, -1).join('.')}_${date}.gpx`, this.createStravaGpx(lines));
    }

    private createStravaGpx(lines: [number, number, number, Recording][]) {
        const gpxData = new StravaBuilder();
        const points = lines.map(([long, lat, ele, entry]) => new Point(lat, long, {
            ele,
            time: new Date(entry.time),
            power: Math.round(entry.power),
            distance: Math.round(entry.distance * 100) / 100,
            cad: Math.round(entry.cadence),
            speed: Math.round(entry.speed * 10) / 10,
            hr: Math.round(entry.heart_rate),
        }));
        gpxData.setTracks([new Track([new Segment(points)], { type: '17' })]);

        return buildGPX(gpxData.toObject());
    }

    public seek(value: number): number {
        if (this.bikeTrainer.getData().distance + this.offset + value >= 0) {
            this.offset += value;
            this.onDistanceUpdated(this.bikeTrainer.getData().distance);
        }
        return this.bikeTrainer.getData().distance + this.offset + value;
    }

    public async prepare(): Promise<void> {
        const files = this.gpxFileInput.files;
        if (files.length === 1) {
            try {
                const gpxFile = files.item(0);

                const gpxData = await this.readTextFile(gpxFile);
                this.gpx = new gpxParser();
                this.gpx.parse(gpxData);
                this.smoothedSegments = this.smooth(this.gpx);

                this.drawPreview();
                this.startWorkoutButton.disabled = false;
            } catch (e) {
                console.error(e);
            }
        }
    }

    async start(): Promise<void> {
        this.initElement.style.display = "block";
        this.startElement.style.display = "none";

        try {
            this.initElement.innerHTML = "Connecting to bike trainer ...";
            await this.bikeTrainer.connect();

            this.initElement.innerHTML = "Starting new workout ...";
            await this.bikeTrainer.startWorkout();
            await new Promise((resolve) => window.setTimeout(resolve, 1000));

            this.gameElement.style.display = "flex";
            this.initElement.style.opacity = "0%";
            window.setTimeout(() => this.initElement.style.display = "none", 5000);

            const [viewer, entity] = this.initMap(this.gpx);
            this.player = entity;
            this.cesiumViewer = viewer;
            this.renderLoop();

            this.onDistanceUpdated(0);
            this.onPaused();
            this.onDataUpdated(<BikeTrainerData>{
                cadence: 0,
                distance: 0,
                power: 0,
                slope: 0,
                speed: 0,
                weight: 0,
            });
        } catch (e) {
            console.error(e);
        }
    }

    public onDataUpdated(bikeTrainerData: BikeTrainerData) {
        this.overlayElement.innerHTML = `
            <div style="display:flex"><div style="flex-grow:1">Speed:</div><div>${Math.round(bikeTrainerData.speed * 10) / 10} km/h</div></div>
            <div style="display:flex"><div style="flex-grow:1">Cadence:</div><div>${Math.round(bikeTrainerData.cadence)}</div></div>
            <div style="display:flex"><div style="flex-grow:1">Power:</div><div>${Math.round(bikeTrainerData.power)} Watts</div></div>
            <div style="display:flex"><div style="flex-grow:1">Distance:</div><div>${Math.round((bikeTrainerData.distance + this.offset) / 10) / 100} km (${Math.round((bikeTrainerData.distance + this.offset) * 1000 / (this.smoothedSegments.length * 20)) / 10}%)</div></div>
            <div style="display:flex"><div style="flex-grow:1">Slope:</div><div>${Math.round(bikeTrainerData.slope * 10) / 10}%</div></div>
        `;
    }

    public onPaused(): void {
        const bikeTrainerData = this.bikeTrainer.getData();
        this.pauseElement.style.display = "block";
        this.overlayElement.style.display = "none";
        this.overlayPausedElement.style.display = "flex";
        const {
            speed: avgSpeed,
            power: avgPower,
            cadence: avgCadence,
        } = this.getAverage();
        this.overlayPausedElement.innerHTML = `
            <div>Paused at ${Math.round((bikeTrainerData.distance + this.offset) / 10) / 100} km (${Math.round((bikeTrainerData.distance + this.offset) * 1000 / (this.smoothedSegments.length * 20)) / 10}%)</div>
            <div style="display:flex"><div style="flex-grow:1">Speed:</div><div>${Math.round(avgSpeed * 10) / 10} km/h</div></div>
            <div style="display:flex"><div style="flex-grow:1">Power:</div><div>${Math.round(avgPower)} Watts</div></div>
            <div style="display:flex"><div style="flex-grow:1">Cadence:</div><div>${Math.round(avgCadence)}</div></div>
            <div style="cursor: pointer; background: #267fca; color: white; text-align: center;" onclick="bikeSimulator.export()">Download GPX</div>`;
    }

    public onResumed() {
        this.pauseElement.style.display = "none";
        this.overlayElement.style.display = "flex";
        this.overlayPausedElement.style.display = "none";
    }

    public onDistanceUpdated(distance: number): void {
        const { slope } = this.bikeTrainer.getData();
        const corrected_distance = distance + this.offset;
        const nextIndex = Math.ceil(corrected_distance / 20);
        const nextSegment = this.smoothedSegments[nextIndex];

        if (nextSegment !== undefined) {
            const nextSlope = Math.max(Math.min(nextSegment.slope, slope + BikeSimulator.MAX_SLOPE_CHANGE), slope - BikeSimulator.MAX_SLOPE_CHANGE);
            this.bikeTrainer.setSlope(nextSlope);
            console.log("sent new slope of", nextSlope);
        }

        if (!this.bikeTrainer.isPaused()) {
            if (Math.ceil(corrected_distance / 20) > Math.ceil(this.progressedDistance / 20)) {
                this.recording[Math.floor(corrected_distance / 20)] = {
                    ...this.bikeTrainer.getData(),
                    distance: corrected_distance,
                    time: Date.now(),
                };
            }
        }

        this.subprogress = 0;
        this.progressedDistance = corrected_distance;
        console.log("distance now at", corrected_distance);
        this.drawChart();
    }

    private drawPreview() {
        if (this.previewChart) {
            this.previewChart.destroy();
            this.previewChart = null;
        }
        this.previewChart = new Chart("chart-preview", {
            type: 'line',
            data: {
                datasets: [{
                    label: "Elevation",
                    data: this.smoothedSegments.map(s => ({
                        x: s.distance,
                        y: s.elevation,
                    })),
                    borderColor: 'grey',
                    yAxisID: 'y-axis-elevation',
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    xAxes: [{
                        type: 'linear',
                        position: 'bottom',
                    }],
                    yAxes: [{
                        type: 'linear',
                        display: true,
                        position: 'left',
                        id: 'y-axis-elevation',
                    }],
                },
            },
        });
    }

    private async readTextFile(file: File): Promise<string> {
        const reader = new FileReader();
        const promisedResult = new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result.toString());
            reader.onerror = (e) => reject(e);
        });
        reader.readAsText(file);
        return promisedResult;
    }

    private initMap(gpx: gpxParser): [Cesium.Viewer, Cesium.Entity] {

        const viewer = new Cesium.Viewer('map', {
            terrainProvider: Cesium.createWorldTerrain(),
            baseLayerPicker: false,
            fullscreenButton: false,
            vrButton: false,
            homeButton: false,
            infoBox: false,
            sceneModePicker: false,
            timeline: false,
            navigationHelpButton: false,
            animation: false,
        });

        const {
            lat: startLat,
            lon: startLng,
        } = gpx.tracks[0].points[0];

        const position = Cesium.Cartesian3.fromDegrees(startLng, startLat, 1000);
        const heading = Cesium.Math.toRadians(135);
        const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll(heading, 0, 0));

        const entity = viewer.entities.add({
            name: "bike",
            position: position,
            orientation: orientation,
            // @ts-ignore
            model: {
                scale: 4,
                uri: './bike.glb',
                color: Cesium.Color.WHITE,
                silhouetteColor: Cesium.Color.ORANGE,
                silhouetteSize: 2,
            },
        });

        const degreeArr = gpx.tracks[0].points
            .map((p) => [p.lon, p.lat])
            .reduce((prev, cur) => prev.concat(cur), []);

        const polyline = new Cesium.GroundPolylineGeometry({
            positions: Cesium.Cartesian3.fromDegreesArray(degreeArr),
            width: 10,
        });

        const geometryInstance = new Cesium.GeometryInstance({
            geometry: polyline,
            id: 'path',
            attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.ORANGE)
            },
        });

        viewer.scene.groundPrimitives.add(
            new Cesium.GroundPolylinePrimitive({
                geometryInstances: geometryInstance,
                appearance: new Cesium.PolylineColorAppearance()
            })
        );

        return [viewer, entity];
    }

    private drawChart(): void {
        const index = Math.ceil(this.progressedDistance / 20);
        const buffer = Math.round(1000 / 20);
        const currentSegments = this.smoothedSegments.slice(Math.max(0, index - buffer), Math.min(this.smoothedSegments.length, index + buffer + 1));
        const data = currentSegments.map(s => ({ x: s.distance, y: s.elevation }));

        this.chart.data.datasets[0].data.splice(0);
        (this.chart.data.datasets[0].data as Array<ChartPoint>).push(...data);

        for (const metric of CHART_METRICS) {
            const dataset = this.chart.data.datasets[metric.datasetIndex];
            const metricData = data.map(d => this.recording[Math.floor(d.x / 20)] ? ({
                x: this.recording[Math.floor(d.x / 20)].distance,
                y: this.recording[Math.floor(d.x / 20)][metric.id],
            }) : null).filter(d => d != null);

            dataset.data.splice(0);
            (dataset.data as Array<ChartPoint>).push(...metricData);
            dataset.hidden = this.activeChartMetric !== metric.datasetIndex;
        }

        this.chart.options.scales.xAxes[0].ticks.min = Math.max(0, index - buffer) * 20;
        this.chart.options.scales.xAxes[0].ticks.max = Math.min(this.smoothedSegments.length, index + buffer) * 20;

        this.chart.update();
    }

    private async renderLoop(): Promise<void> {
        const bikeTrainerData = this.bikeTrainer.getData();
        const viewerDist = MathHelpers.interpolate(bikeTrainerData.speed, 200, 300);
        const viewerHeight = MathHelpers.interpolate(bikeTrainerData.speed, 30, 100);
        const meterPerSecond = bikeTrainerData.speed / 3.6;
        const deltaT = performance.now() - this.lastRender;
        this.lastRender = performance.now();
        this.subprogress += deltaT / 1000 * meterPerSecond;

        const nextIndex = Math.ceil((this.progressedDistance + this.subprogress) / 20);
        const nextSegment = this.smoothedSegments[nextIndex];
        const prevSegment = nextIndex > 0 ? this.smoothedSegments[nextIndex - 1] : nextSegment;

        const playerPosition = this.getPos();
        const playerRotation = MathHelpers.bearing(prevSegment.lat, prevSegment.lng, nextSegment.lat, nextSegment.lng);
        const playerCartographic = Cesium.Cartographic.fromDegrees(playerPosition.longitude, playerPosition.latitude);
        Cesium.sampleTerrainMostDetailed(this.cesiumViewer.terrainProvider, [playerCartographic]).then(([terrainUnderPlayer]) => {

            const playerFixed = Cesium.Cartesian3.fromDegrees(playerPosition.longitude, playerPosition.latitude, terrainUnderPlayer.height);
            const heading = Cesium.Math.toRadians(playerRotation);
            const orientation = Cesium.Transforms.headingPitchRollQuaternion(playerFixed, new Cesium.HeadingPitchRoll(heading, 0, 0));

            this.player.orientation = orientation;
            this.player.position = playerFixed;

            // @ts-ignore
            const localToFixed = Cesium.Transforms.localFrameToFixedFrameGenerator("east", "north")(playerFixed);

            const cameraTarget = (Math.PI * 2 - heading + Math.PI * 1.5) % (Math.PI * 2);
            const leftRotationDistance = cameraTarget > this.cameraRotation ? cameraTarget - this.cameraRotation : Math.PI * 2 - this.cameraRotation + cameraTarget;
            const rightRotationDistance = cameraTarget < this.cameraRotation ? this.cameraRotation - cameraTarget : this.cameraRotation + Math.PI * 2 - cameraTarget;

            if (leftRotationDistance < rightRotationDistance) {
                if (leftRotationDistance > Math.PI / 180) {
                    this.cameraRotation += Math.sqrt(leftRotationDistance) / 100;
                }
            } else {
                if (rightRotationDistance > Math.PI / 180) {
                    this.cameraRotation -= Math.sqrt(rightRotationDistance) / 100;
                }
            }
            this.cameraRotation = (this.cameraRotation + Math.PI * 2) % (Math.PI * 2);
            const s = Math.sin(this.cameraRotation);
            const c = Math.cos(this.cameraRotation);
            const camLocal = new Cesium.Cartesian3(viewerDist * c, viewerDist * s, 0);
            const camFixed = new Cesium.Cartesian3();
            Cesium.Matrix4.multiplyByPointAsVector(localToFixed, camLocal, camFixed);

            const camFixedWorld = new Cesium.Cartesian3();
            Cesium.Cartesian3.add(camFixed, playerFixed, camFixedWorld);
            const camCartographic = Cesium.Cartographic.fromCartesian(camFixedWorld);

            Cesium.sampleTerrainMostDetailed(this.cesiumViewer.terrainProvider, [camCartographic]).then(([terrainUnderCam]) => {
                const correctedHeight = terrainUnderCam.height < terrainUnderPlayer.height ? viewerHeight : terrainUnderCam.height + viewerHeight - terrainUnderPlayer.height;
                const camCorrectedHeight = new Cesium.Cartesian3(viewerDist * c, viewerDist * s, correctedHeight);
                this.cesiumViewer.camera.lookAt(playerFixed, camCorrectedHeight);
            });
        });

        Cesium.requestAnimationFrame(this.renderLoop.bind(this));
    }

    private smooth(gpx: gpxParser): SmoothedSegment[] {
        const segments = gpx.tracks[0].points.map((p, i) => ({
            distance: i > 0 ? gpx.tracks[0].distance.cumul[i - 1] : 0,
            slope: i > 0 ? gpx.tracks[0].slopes[i - 1] : 0,
            ...p,
        })).filter((s) => s.slope !== Infinity && s.slope !== -Infinity);

        let x = 0;
        const interval = 20.0;
        let i = 0;
        let current = null;
        let prev = undefined;
        const smoothedSegments = [];
        const num_neighbours = 5;
        for (x = 0; x < gpx.tracks[0].distance.total; x += interval) {
            for (; i < segments.length; i++) {
                if (segments[i].distance >= x) {
                    current = segments[i];
                    prev = i > 0 ? segments[i - 1] : undefined;
                    if (prev !== undefined) {
                        const coveredDistance = current.distance - prev.distance;
                        const deltaElevation = current.ele - prev.ele;
                        const deltaLat = current.lat - prev.lat;
                        const deltaLng = current.lon - prev.lon;
                        const overshot = x - prev.distance;
                        current = {
                            distance: x,
                            slope: ((overshot / coveredDistance) * deltaElevation) / overshot * 100.0,
                            lat: prev.lat + (overshot / coveredDistance) * deltaLat,
                            lon: prev.lon + (overshot / coveredDistance) * deltaLng,
                        };
                    }

                    const left = Math.max(0, smoothedSegments.length - num_neighbours);
                    const elements = smoothedSegments.slice(left, smoothedSegments.length).concat([current]);

                    const mean = elements.reduce((prev, current) => prev + current.slope, 0) / elements.length;

                    smoothedSegments.push({
                        distance: x,
                        slope: mean,
                        elevation: smoothedSegments.length > 0 ? smoothedSegments[smoothedSegments.length - 1].elevation + mean / 100.0 * interval : segments[0].ele,
                        lat: current.lat,
                        lng: current.lon,
                    });
                    break;
                }
            }
        }

        let warnings = 0;
        smoothedSegments.forEach((v, i) => {
            if (i > 0) {
                if (v.slope - smoothedSegments[i - 1].slope > 1) {
                    console.log("warning:", smoothedSegments[i - 1], v);
                    warnings++;
                }
            }
        });

        console.log("warnings:", warnings);
        console.log(smoothedSegments);

        console.log(smoothedSegments.map(s => `${s.distance};${s.elevation}`).join("\n"))

        return smoothedSegments;
    }

    private getAverage(): { speed: number, power: number, cadence: number } {
        return this.recording.reduce((avg, cur, n) => ({
            speed: (avg.speed * n + cur.speed) / (n + 1),
            power: (avg.power * n + cur.power) / (n + 1),
            cadence: (avg.cadence * n + cur.cadence) / (n + 1),
        }), {
            speed: 0,
            power: 0,
            cadence: 0,
        });
    }

    private getPos(): RiderPosition {
        return this.getPosByDistance(this.progressedDistance + this.subprogress);
    }

    private getPosByDistance(distance: number): RiderPosition {
        const nextIndex = Math.ceil(distance / 20);
        const nextSegment = this.smoothedSegments[Math.min(nextIndex, this.smoothedSegments.length - 1)];
        const prevSegment = nextIndex > 0 ? this.smoothedSegments[nextIndex - 1] : undefined;

        if (prevSegment === undefined) {
            return {
                latitude: nextSegment.lat,
                longitude: nextSegment.lng,
                elevation: nextSegment.elevation,
            };
        } else {
            const coveredDistance = nextSegment.distance - prevSegment.distance;
            const percent = (distance - prevSegment.distance) / coveredDistance;

            return {
                latitude: prevSegment.lat + (nextSegment.lat - prevSegment.lat) * percent,
                longitude: prevSegment.lng + (nextSegment.lng - prevSegment.lng) * percent,
                elevation: prevSegment.elevation + (nextSegment.elevation - prevSegment.elevation) * percent,
            };
        }
    }
}
