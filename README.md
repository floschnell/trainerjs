# Bushido-JS

Bushido-JS is a Typescript package of tools to be used with the Tacx Bushido (t1980) home trainer.

## Simulator WebApp

This webapp enables you to use your Tacx Bushido hometrainer to ride any existing GPX track.

The features of the webapp are:
- loading and smoothing of a GPX route
- connecting to your Bushido trainer (via WebUSB)
- collecting metrics like power, speed, cadence and heart rate
- adjusting slope depending on your current position on the GPX route
- rendering your position into a 3d environment via CesiumJS
- exporting your stats as a GPX file, so you can share your efforts on Strava or elsewhere

## WebUSB Driver

Checkout [the USB driver file](./src/BushidoUSB.ts) for a very lightweight Bushido t1980 ANT+ driver. It is capable of reading speed, distance, power, cadence and heart rate from the Bushido control unit. Furthermore, it lets you control the device's simulated slope. This driver sits at the heart of the simulation component. The Bushido communication protocol is actually proprietary. However, there have been successful attempts in deciphering the different messages. You can [find the documentation here](https://github.com/fluxoid-org/CyclismoProject/wiki/Tacx-Bushido-Headunit-protocol).
