const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/index.ts',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ],
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    library: 'BushidoJS',
    libraryTarget: 'var'
  },
  externals: {
      cesium: 'Cesium',
      'chart.js': 'Chart',
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "data", to: "." },
        { from: "src/index.html", to: "." },
        { from: "src/styles.css", to: "." },
      ],
    }),
  ]
};