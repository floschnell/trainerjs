export class MathHelpers {
    public static interpolate(speed: number, min: number, max: number): number {
        return max - Math.max(0, 50 - speed) / 50 * (max - min);
    }

    public static toRadians(degrees: number): number {
        return degrees * Math.PI / 180;
    }

    public static toDegrees(radians: number): number {
        return radians * 180 / Math.PI;
    }

    public static bearing(startLat: number, startLng: number, destLat: number, destLng: number): number {
        startLat = MathHelpers.toRadians(startLat);
        startLng = MathHelpers.toRadians(startLng);
        destLat = MathHelpers.toRadians(destLat);
        destLng = MathHelpers.toRadians(destLng);
    
        const y = Math.sin(destLng - startLng) * Math.cos(destLat);
        const x = Math.cos(startLat) * Math.sin(destLat) -
            Math.sin(startLat) * Math.cos(destLat) * Math.cos(destLng - startLng);
        let brng = Math.atan2(y, x);
        brng = MathHelpers.toDegrees(brng);
        return (brng + 360) % 360;
    }
}